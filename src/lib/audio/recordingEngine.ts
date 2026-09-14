import {
  ActiveMeetingSessionState,
  AudioChunkMetadata,
  ActiveMeetingEngineStatus,
  AudioSourceStatus,
  MediaRecorderStatus,
  MeetingSourceType,
} from "@/types/database";
import {
  saveActiveSessionToIndexedDB,
  getActiveSessionFromIndexedDB,
  clearActiveSessionInIndexedDB,
  saveChunkToIndexedDB,
  getPendingChunksFromIndexedDB,
  removeChunkFromIndexedDB,
  clearMeetingChunksInIndexedDB,
} from "@/lib/storage/indexedDbQueue";
import {
  syncActiveMeetingToSupabase,
  uploadAudioChunkDeduplicated,
  fetchActiveMeetingFromSupabase,
  closeActiveMeetingInSupabase,
} from "@/lib/supabase/client";
import {
  requestScreenWakeLock,
  releaseScreenWakeLock,
  startAudioKeepAlive,
  stopAudioKeepAlive,
} from "@/lib/audio/recordingKeepAlive";

export interface RecordingEngineListeners {
  onStatusChange?: (status: ActiveMeetingEngineStatus, session: ActiveMeetingSessionState | null) => void;
  onTimerTick?: (seconds: number) => void;
  onChunkCaptured?: (blob: Blob, sequenceNumber: number) => void;
  onSourceInterrupted?: (reason: string) => void;
  onError?: (err: Error) => void;
}

class RecordingEngineService {
  private activeSession: ActiveMeetingSessionState | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private sequenceNumber: number = 0;

  private timerInterval: NodeJS.Timeout | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private isProcessingQueue: boolean = false;
  private wakeLockEnabled: boolean = true;

  private listeners: Set<RecordingEngineListeners> = new Set();
  private isInitialized: boolean = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.initGlobalEventListeners();
    }
  }

  /**
   * Subscrever ouvintes de interface aos eventos da engine
   */
  public subscribe(listener: RecordingEngineListeners): () => void {
    this.listeners.add(listener);
    // Notificar estado atual imediatamente ao se inscrever
    if (this.activeSession) {
      listener.onStatusChange?.(this.activeSession.status, this.activeSession);
      listener.onTimerTick?.(this.getElapsedSeconds());
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyStatusChange() {
    this.listeners.forEach((l) => l.onStatusChange?.(this.activeSession?.status || "idle", this.activeSession));
  }

  private notifyTimerTick(sec: number) {
    this.listeners.forEach((l) => l.onTimerTick?.(sec));
  }

  private notifyChunkCaptured(blob: Blob, seq: number) {
    this.listeners.forEach((l) => l.onChunkCaptured?.(blob, seq));
  }

  private notifySourceInterrupted(reason: string) {
    this.listeners.forEach((l) => l.onSourceInterrupted?.(reason));
  }

  private notifyError(err: Error) {
    this.listeners.forEach((l) => l.onError?.(err));
  }

  /**
   * Inicializar ouvintes globais de visibilidade, online/offline, pagehide e unload
   */
  private initGlobalEventListeners() {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    // Page Visibility API Handler (Auto-pausa ao apagar a tela / esconder e auto-retoma ao voltar)
    document.addEventListener("visibilitychange", async () => {
      if (!this.activeSession || this.activeSession.status === "finished") return;

      if (document.visibilityState === "hidden") {
        console.log("📍 [RecordingEngine] Aplicação entrou em segundo plano / tela apagada.");
        this.activeSession.status = "background";
        this.activeSession.last_activity_at = new Date().toISOString();

        // Segurança Extra iOS/Mobile: Pausar gravação se a tela apagar para não perder dados nem corromper áudio
        if (this.activeSession.recorder_status === "recording") {
          console.log("📱 [RecordingEngine] Tela apagada/minimizada. Reunião pausada automaticamente por segurança.");
          this.pauseRecording("screen_off");
        }

        await this.persistCurrentState();
        this.notifyStatusChange();
      } else if (document.visibilityState === "visible") {
        console.log("👁️ [RecordingEngine] Aplicação retornou a primeiro plano / tela acesa.");
        this.activeSession.last_activity_at = new Date().toISOString();

        // Se a reunião foi pausada automaticamente ao apagar a tela, retomar automaticamente agora
        if (this.activeSession.recorder_status === "paused" && this.activeSession.auto_paused_reason === "screen_off") {
          console.log("👁️ [RecordingEngine] Tela acesa/retornou a primeiro plano. Reunião retomada automaticamente com segurança.");
          this.resumeRecording();
        } else if (this.activeSession.status === "background") {
          this.activeSession.status = "recording";
        }

        if (this.wakeLockEnabled) {
          await requestScreenWakeLock();
        }

        await this.syncWithBackendAndLocal();
        this.notifyStatusChange();
      }
    });

    // Saída de página / Unload (Salvar estado pendente sem alterar status para finished)
    const handleBeforeUnload = async () => {
      if (this.activeSession && this.activeSession.status !== "finished") {
        this.activeSession.last_activity_at = new Date().toISOString();
        await this.persistCurrentState();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    // Eventos Online / Offline
    window.addEventListener("online", async () => {
      console.log("🌐 [RecordingEngine] Dispositivo reconectado à internet. Drenando fila IndexedDB...");
      if (this.activeSession && this.activeSession.status === "reconnecting") {
        this.activeSession.status = "recording";
        this.notifyStatusChange();
      }
      await this.drainPendingChunksQueue();
    });

    window.addEventListener("offline", () => {
      console.warn("⚠️ [RecordingEngine] Dispositivo ficou offline. Chunks serão preservados no IndexedDB local.");
      if (this.activeSession && this.activeSession.status === "recording") {
        this.activeSession.status = "reconnecting";
        this.notifyStatusChange();
      }
    });

    // Verificar se existe sessão ativa salva ao inicializar
    this.restoreActiveSessionOnLoad();
  }

  /**
   * Tenta restaurar reunião ativa armazenada no IndexedDB/Supabase ao carregar a página
   */
  public async restoreActiveSessionOnLoad(): Promise<ActiveMeetingSessionState | null> {
    try {
      let session = await getActiveSessionFromIndexedDB();
      if (!session) {
        session = await fetchActiveMeetingFromSupabase();
      }

      if (session && session.status !== "finished") {
        console.log("🔄 [RecordingEngine] Reunião ativa detectada:", session.meeting_id);
        this.activeSession = session;

        // Se o MediaRecorder já não estiver mais em memória (ex: pós refresh),
        // mantemos os metadados para oferecer a recuperação ao usuário
        if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
          if (session.status === "recording") {
            session.status = "background";
          }
        }

        this.startTimerLoop();
        this.startSyncHeartbeat();
        this.notifyStatusChange();
        return session;
      }
    } catch (err) {
      console.warn("Erro ao restaurar sessão ativa:", err);
    }
    return null;
  }

  /**
   * Iniciar uma nova gravação com suporte a persistência
   */
  public async startRecording(params: {
    meetingId: string;
    title: string;
    sourceType: MeetingSourceType;
    stream: MediaStream;
    wakeLockEnabled?: boolean;
    chunkIntervalMs?: number;
  }): Promise<ActiveMeetingSessionState> {
    const { meetingId, title, sourceType, stream, wakeLockEnabled = true, chunkIntervalMs = 8000 } = params;

    // Se houver stream/recorder antigo diferente em execução, encerrar graciosamente antes de iniciar nova
    if (this.mediaStream && this.mediaStream !== stream) {
      try {
        this.mediaStream.getTracks().forEach((t) => t.stop());
      } catch (e) {}
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const sessionState: ActiveMeetingSessionState = {
      meeting_id: meetingId,
      session_id: sessionId,
      title: title || "Reunião Sem Título",
      source_type: sourceType,
      status: "recording",
      started_at: nowIso,
      started_at_ms: Date.now(),
      last_chunk_at: nowIso,
      last_activity_at: nowIso,
      source_status: "active",
      recorder_status: "recording",
      accumulated_paused_ms: 0,
      wake_lock_enabled: wakeLockEnabled,
      transcript_draft: "",
      speaker_map: {},
      segments_draft: [],
    };

    this.activeSession = sessionState;
    this.mediaStream = stream;
    this.audioChunks = [];
    this.sequenceNumber = 0;
    this.wakeLockEnabled = wakeLockEnabled;

    if (wakeLockEnabled) {
      await requestScreenWakeLock();
    }
    startAudioKeepAlive();

    // Monitorar faixas de áudio (Mute/Unmute para iOS e Android)
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        console.warn("🚨 [RecordingEngine] AudioTrack encerrada pelo sistema/usuário.");
        this.handleSourceEnded("Faixa de áudio encerrada");
      };
      track.onmute = () => {
        console.warn("⏸️ [RecordingEngine] AudioTrack mutada pelo iOS/Sistema. Auto-pausando gravação.");
        if (this.activeSession && this.activeSession.recorder_status === "recording") {
          this.pauseRecording("mic_mute");
        }
      };
      track.onunmute = () => {
        console.log("▶️ [RecordingEngine] AudioTrack desmutada pelo iOS/Sistema. Retomando gravação.");
        if (this.activeSession && this.activeSession.recorder_status === "paused" && this.activeSession.auto_paused_reason === "mic_mute") {
          this.resumeRecording();
        }
      };
    });

    // Configurar MediaRecorder com fallback multi-navegador (Chrome, Firefox, Safari iOS/macOS, Edge)
    let mimeType = "";
    if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      } else if (MediaRecorder.isTypeSupported("audio/aac")) {
        mimeType = "audio/aac";
      } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
        mimeType = "audio/ogg";
      }
    }

    const recorderOptions = mimeType ? { mimeType } : undefined;
    const recorder = new MediaRecorder(stream, recorderOptions);
    this.mediaRecorder = recorder;

    recorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0) {
        await this.handleChunkAvailable(event.data);
      }
    };

    recorder.onerror = (e: any) => {
      console.error("Erro no MediaRecorder:", e);
      this.notifyError(new Error("Falha no gravador de áudio do navegador."));
    };

    recorder.start(chunkIntervalMs);

    await this.persistCurrentState();
    this.startTimerLoop();
    this.startSyncHeartbeat();
    this.notifyStatusChange();

    return sessionState;
  }


  /**
   * Trata novos blocos de áudio gerados pelo MediaRecorder
   */
  private async handleChunkAvailable(blob: Blob) {
    if (!this.activeSession) return;

    this.audioChunks.push(blob);
    this.sequenceNumber += 1;
    const currentSeq = this.sequenceNumber;
    const elapsedSec = this.getElapsedSeconds();

    const chunkId = `${this.activeSession.meeting_id}_${this.activeSession.session_id}_${currentSeq}`;

    const chunkMeta: AudioChunkMetadata = {
      id: chunkId,
      meeting_id: this.activeSession.meeting_id,
      session_id: this.activeSession.session_id,
      sequence_number: currentSeq,
      timestamp_start: elapsedSec,
      duration_seconds: 8.0,
      blob: blob,
      status: "pending_local",
      created_at: new Date().toISOString(),
    };

    // 1. Salvar no IndexedDB imediatamente
    await saveChunkToIndexedDB(chunkMeta);

    // 2. Atualizar timestamps
    this.activeSession.last_chunk_at = new Date().toISOString();
    this.activeSession.last_activity_at = new Date().toISOString();
    await saveActiveSessionToIndexedDB(this.activeSession);

    // 3. Tentar upload e deduplicação no backend Supabase
    this.notifyChunkCaptured(blob, currentSeq);
    this.drainPendingChunksQueue();
  }

  /**
   * Processar e drenar a fila local de chunks do IndexedDB para o Supabase
   */
  private async drainPendingChunksQueue() {
    if (this.isProcessingQueue || !this.activeSession) return;
    this.isProcessingQueue = true;

    try {
      const pending = await getPendingChunksFromIndexedDB(this.activeSession.meeting_id);
      for (const chunk of pending) {
        const success = await uploadAudioChunkDeduplicated(chunk);
        if (success) {
          await removeChunkFromIndexedDB(chunk.id);
        }
      }
    } catch (err) {
      console.warn("Erro ao drenar fila de chunks:", err);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Trata interrupção de entrada de áudio (ex: track.onended)
   */
  private handleSourceEnded(reason: string) {
    if (!this.activeSession || this.activeSession.status === "finished") return;

    this.activeSession.source_status = "ended";
    this.activeSession.status = "interrupted";
    this.activeSession.last_activity_at = new Date().toISOString();

    this.persistCurrentState();
    this.notifySourceInterrupted(reason);
    this.notifyStatusChange();
  }

  /**
   * Calcular duração da reunião em segundos baseando-se no timestamp real Date.now() - started_at
   * Desconta precisamente o tempo acumulado em pausa (accumulated_paused_ms + tempo atual de pausa)
   */
  public getElapsedSeconds(): number {
    if (!this.activeSession) return 0;

    const startMs = this.activeSession.started_at_ms || new Date(this.activeSession.started_at).getTime();
    const accumulatedPausedMs = this.activeSession.accumulated_paused_ms || 0;

    // Se estiver atualmente pausado, congelar o tempo no instante em que a pausa começou
    let currentMs = Date.now();
    if (this.activeSession.recorder_status === "paused") {
      if (this.activeSession.paused_at_ms) {
        currentMs = this.activeSession.paused_at_ms;
      }
    }

    const diffMs = Math.max(0, currentMs - startMs - accumulatedPausedMs);
    return Math.floor(diffMs / 1000);
  }

  /**
   * Loop do cronômetro em tempo real
   */
  private startTimerLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.activeSession && (this.activeSession.status === "recording" || this.activeSession.status === "background")) {
        const sec = this.getElapsedSeconds();
        this.notifyTimerTick(sec);
      }
    }, 500);
  }

  /**
   * Loop de sincronização de heartbeat com IndexedDB e Supabase (a cada 10 segundos)
   */
  private startSyncHeartbeat() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(async () => {
      if (this.activeSession && this.activeSession.status !== "finished") {
        this.activeSession.last_activity_at = new Date().toISOString();
        await this.persistCurrentState();
      }
    }, 10000);
  }

  /**
   * Persiste estado atual no IndexedDB e Supabase
   */
  private async persistCurrentState() {
    if (!this.activeSession) return;
    await saveActiveSessionToIndexedDB(this.activeSession);
    await syncActiveMeetingToSupabase(this.activeSession);
  }

  /**
   * Sincroniza estado com IndexedDB/Supabase
   */
  private async syncWithBackendAndLocal() {
    if (!this.activeSession) return;
    const remote = await fetchActiveMeetingFromSupabase(this.activeSession.meeting_id);
    if (remote) {
      // Mesclar drafts se existirem no servidor
      if (remote.transcript_draft) this.activeSession.transcript_draft = remote.transcript_draft;
      if (remote.speaker_map) this.activeSession.speaker_map = remote.speaker_map;
    }
    await this.persistCurrentState();
  }

  /**
   * Pausar gravação temporariamente e congelar o relógio
   */
  public pauseRecording(reason: "screen_off" | "mic_mute" | "user" = "user") {
    if (this.activeSession && this.activeSession.recorder_status !== "paused") {
      if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
        try {
          this.mediaRecorder.pause();
        } catch (e) {
          console.warn("Aviso ao pausar MediaRecorder:", e);
        }
      }
      this.activeSession.recorder_status = "paused";
      this.activeSession.paused_at_ms = Date.now();
      this.activeSession.auto_paused_reason = reason;
      this.persistCurrentState();
      this.notifyStatusChange();
      this.notifyTimerTick(this.getElapsedSeconds());
    }
  }

  /**
   * Retomar gravação pausada e reiniciar contagem do relógio
   */
  public resumeRecording() {
    if (this.activeSession && this.activeSession.recorder_status === "paused") {
      if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
        try {
          this.mediaRecorder.resume();
        } catch (e) {
          console.warn("Aviso ao retomar MediaRecorder:", e);
        }
      }

      if (this.activeSession.paused_at_ms) {
        const pauseDurationMs = Math.max(0, Date.now() - this.activeSession.paused_at_ms);
        this.activeSession.accumulated_paused_ms = (this.activeSession.accumulated_paused_ms || 0) + pauseDurationMs;
        this.activeSession.paused_at_ms = undefined;
      }

      this.activeSession.recorder_status = "recording";
      this.activeSession.auto_paused_reason = null;
      if (this.wakeLockEnabled) {
        requestScreenWakeLock();
      }
      this.persistCurrentState();
      this.notifyStatusChange();
      this.notifyTimerTick(this.getElapsedSeconds());
    }
  }

  /**
   * ATUALIZAR RASCUNHO DA TRANSCRIÇÃO (para preservação contínua da transcrição)
   */
  public updateTranscriptDraft(rawText: string, speakerMap?: Record<string, string>) {
    if (!this.activeSession) return;
    this.activeSession.transcript_draft = rawText;
    if (speakerMap) this.activeSession.speaker_map = speakerMap;
    saveActiveSessionToIndexedDB(this.activeSession);
  }

  /**
   * FUNÇÃO CENTRALIZADA: finishMeeting()
   * Única rotina permitida para alterar status da reunião para 'finished'.
   */
  public async finishMeeting(): Promise<{
    meetingId: string;
    durationSeconds: number;
    audioBlob: Blob;
    transcriptDraft: string;
    speakerMap: Record<string, string>;
  }> {
    if (!this.activeSession) {
      throw new Error("Nenhuma reunião ativa para finalizar.");
    }

    const finalMeetingId = this.activeSession.meeting_id;
    const finalDuration = this.getElapsedSeconds();
    const finalTranscript = this.activeSession.transcript_draft || "";
    const finalSpeakerMap = this.activeSession.speaker_map || {};

    console.log("🏁 [RecordingEngine] Encerrando gravação e finalizando reunião:", finalMeetingId);

    // 1. Alterar status para finishing
    this.activeSession.status = "finishing";
    this.notifyStatusChange();

    // 2. Parar MediaRecorder e faixas de mídia
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }

    releaseScreenWakeLock();
    stopAudioKeepAlive();

    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.syncInterval) clearInterval(this.syncInterval);

    // 3. Processar último bloco de áudio e concatenar todos os blobs
    const finalAudioBlob = new Blob(this.audioChunks, { type: "audio/webm" });

    // 4. Efetuar upload de quaisquer chunks pendentes na fila local
    await this.drainPendingChunksQueue();

    // 5. Marcar reunião como finalizada no banco de dados e IndexedDB
    this.activeSession.status = "finished";
    this.activeSession.ended_at = new Date().toISOString();

    await closeActiveMeetingInSupabase(finalMeetingId);
    await clearActiveSessionInIndexedDB(finalMeetingId);
    await clearMeetingChunksInIndexedDB(finalMeetingId);

    const result = {
      meetingId: finalMeetingId,
      durationSeconds: finalDuration,
      audioBlob: finalAudioBlob,
      transcriptDraft: finalTranscript,
      speakerMap: finalSpeakerMap,
    };

    this.notifyStatusChange();
    this.activeSession = null;
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];

    return result;
  }

  /**
   * Obter sessão de reunião ativa no momento
   */
  public getActiveSession(): ActiveMeetingSessionState | null {
    return this.activeSession;
  }

  /**
   * Verificar se há reunião ativa
   */
  public isRecordingActive(): boolean {
    return !!this.activeSession && this.activeSession.status !== "finished" && this.activeSession.status !== "idle";
  }

  /**
   * Verificar se existe uma gravação ativa em memória com MediaRecorder ativo
   */
  public hasLiveRecorder(): boolean {
    return !!this.mediaRecorder && (this.mediaRecorder.state === "recording" || this.mediaRecorder.state === "paused");
  }

  /**
   * Cancelar sessão ativa limpando dados
   */
  public async cancelActiveSession(): Promise<void> {
    if (this.activeSession) {
      const meetingId = this.activeSession.meeting_id;
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        try {
          this.mediaRecorder.stop();
        } catch (e) {}
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((t) => t.stop());
      }
      releaseScreenWakeLock();
      stopAudioKeepAlive();
      await closeActiveMeetingInSupabase(meetingId);
      await clearActiveSessionInIndexedDB(meetingId);
      await clearMeetingChunksInIndexedDB(meetingId);
      this.activeSession = null;
      this.mediaRecorder = null;
      this.mediaStream = null;
      this.audioChunks = [];
      this.notifyStatusChange();
    }
  }
}

// Exportar instância singleton para uso global na aplicação
export const recordingEngine = new RecordingEngineService();

