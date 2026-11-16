import {
  ActiveMeetingSessionState,
  ActiveMeetingEngineStatus,
  MeetingSourceType,
} from "@/types/database";
import {
  saveActiveSessionToIndexedDB,
  getActiveSessionFromIndexedDB,
  clearActiveSessionInIndexedDB,
} from "@/lib/storage/indexedDbQueue";
import {
  saveChunk,
  clearSessionChunks,
  countChunks,
} from "@/lib/recording/chunkStore";
import {
  processUploadQueue,
  destroyUploader,
} from "@/lib/recording/chunkUploader";
import {
  syncActiveMeetingToSupabase,
  fetchActiveMeetingFromSupabase,
  closeActiveMeetingInSupabase,
  isSupabaseConfigured,
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
  onChunkTranscribed?: (text: string, segments: any[]) => void;
  onSourceInterrupted?: (reason: string) => void;
  onError?: (err: Error) => void;
}

const CHUNK_DURATION_MS = 5000;

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/aac",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

class RecordingEngineService {
  private activeSession: ActiveMeetingSessionState | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private sequenceNumber: number = 0;

  // Recursos de Áudio e Visualização (AudioContext, AnalyserNode, AnimationFrame)
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private audioSourceNode: MediaStreamAudioSourceNode | null = null;
  private animationFrameId: number | null = null;
  private objectUrlsToRevoke: Set<string> = new Set();

  private timerInterval: NodeJS.Timeout | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private memoryMonitorInterval: NodeJS.Timeout | null = null;
  private wakeLockEnabled: boolean = true;

  private listeners: Set<RecordingEngineListeners> = new Set();
  private isInitialized: boolean = false;
  private restorePromise: Promise<ActiveMeetingSessionState | null> | null = null;

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

  private notifyChunkTranscribed(text: string, segments: any[]) {
    this.listeners.forEach((l) => l.onChunkTranscribed?.(text, segments));
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
        console.log("📍 [RecordingEngine] Aplicação em segundo plano / tela apagada.");
        this.activeSession.status = "background";
        this.activeSession.last_activity_at = new Date().toISOString();

        if (this.activeSession.recorder_status === "recording") {
          console.log("📱 [RecordingEngine] Auto-pausa preventiva no mobile.");
          this.pauseRecording("screen_off");
        }

        await this.persistCurrentState();
        this.notifyStatusChange();
      } else if (document.visibilityState === "visible") {
        console.log("👁️ [RecordingEngine] Aplicação retornou a primeiro plano.");
        this.activeSession.last_activity_at = new Date().toISOString();

        if (this.activeSession.recorder_status === "paused" && this.activeSession.auto_paused_reason === "screen_off") {
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

    // Saída de página / Unload
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
      console.log("🌐 [RecordingEngine] Conectado. Processando fila do IndexedDB...");
      if (this.activeSession && this.activeSession.status === "reconnecting") {
        this.activeSession.status = "recording";
        this.notifyStatusChange();
      }
      this.triggerUploadQueue();
    });

    window.addEventListener("offline", () => {
      console.warn("⚠️ [RecordingEngine] Dispositivo offline. Chunks protegidos no IndexedDB em disco.");
      if (this.activeSession && this.activeSession.status === "recording") {
        this.activeSession.status = "reconnecting";
        this.notifyStatusChange();
      }
    });

    this.restoreActiveSessionOnLoad();
  }

  /**
   * Tenta restaurar reunião ativa armazenada no IndexedDB/Supabase ao carregar a página
   */
  public async restoreActiveSessionOnLoad(): Promise<ActiveMeetingSessionState | null> {
    if (this.restorePromise) {
      return this.restorePromise;
    }

    this.restorePromise = (async () => {
      try {
        let session = await getActiveSessionFromIndexedDB();
        if (!session && isSupabaseConfigured()) {
          session = await fetchActiveMeetingFromSupabase();
        }

        if (session && session.status !== "finished") {
          console.log("🔄 [RecordingEngine] Reunião ativa detectada:", session.meeting_id);
          this.activeSession = session;

          if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
            if (session.status === "recording") {
              session.status = "background";
            }
          }

          this.startTimerLoop();
          this.startSyncHeartbeat();
          this.startMemoryMonitor();
          this.notifyStatusChange();
          return session;
        }
      } catch (err) {
        console.warn("Erro ao restaurar sessão ativa:", err);
      } finally {
        this.restorePromise = null;
      }
      return null;
    })();

    return this.restorePromise;
  }

  /**
   * Registrar ObjectURL para controle e revogação estrita
   */
  public registerObjectURL(url: string): string {
    this.objectUrlsToRevoke.add(url);
    return url;
  }

  /**
   * Revogar todas as ObjectURLs ativas
   */
  public revokeAllObjectURLs(): void {
    this.objectUrlsToRevoke.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    });
    this.objectUrlsToRevoke.clear();
  }

  /**
   * Iniciar uma nova gravação em chunks sequenciais com ZERO Blobs em RAM
   */
  public async startRecording(params: {
    meetingId: string;
    title: string;
    sourceType: MeetingSourceType;
    stream: MediaStream;
    wakeLockEnabled?: boolean;
    chunkIntervalMs?: number;
  }): Promise<ActiveMeetingSessionState> {
    const { meetingId, title, sourceType, stream, wakeLockEnabled = true } = params;

    // Prevenção de dupla gravação / limpar gravadores anteriores
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      return this.activeSession!;
    }

    if (this.mediaStream && this.mediaStream !== stream) {
      try {
        this.mediaStream.getTracks().forEach((t) => t.stop());
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
    this.sequenceNumber = 0;
    this.wakeLockEnabled = wakeLockEnabled;

    if (wakeLockEnabled) {
      await requestScreenWakeLock();
    }
    startAudioKeepAlive();

    // Monitorar faixas de áudio
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        console.warn("🚨 [RecordingEngine] AudioTrack encerrada pelo sistema/usuário.");
        this.handleSourceEnded("Faixa de áudio encerrada");
      };
      track.onmute = () => {
        if (this.activeSession && this.activeSession.recorder_status === "recording") {
          this.pauseRecording("mic_mute");
        }
      };
      track.onunmute = () => {
        if (this.activeSession && this.activeSession.recorder_status === "paused" && this.activeSession.auto_paused_reason === "mic_mute") {
          this.resumeRecording();
        }
      };
    });

    // Configurar MediaRecorder de 64 kbps Opus/WebM seguro
    const mimeType = getSupportedMimeType();
    const recorderOptions: MediaRecorderOptions = {
      audioBitsPerSecond: 64000,
    };
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
    }

    const recorder = new MediaRecorder(stream, recorderOptions);
    this.mediaRecorder = recorder;

    recorder.ondataavailable = async (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return;
      await this.persistAndUploadChunk(event.data);
    };

    recorder.onerror = (e: any) => {
      console.error("Erro no MediaRecorder:", e);
      this.notifyError(new Error("Falha no gravador de áudio do navegador."));
    };

    recorder.start(CHUNK_DURATION_MS);

    await this.persistCurrentState();
    this.startTimerLoop();
    this.startSyncHeartbeat();
    this.startMemoryMonitor();
    this.notifyStatusChange();

    return sessionState;
  }

  /**
   * Persistir chunk no IndexedDB e disparar uploader (ZERO acúmulo de Blob em RAM)
   */
  private async persistAndUploadChunk(blob: Blob) {
    if (!this.activeSession) return;

    this.sequenceNumber += 1;
    const currentSeq = this.sequenceNumber;
    const sessionId = this.activeSession.meeting_id;
    const chunkId = `${sessionId}-${currentSeq}`;

    try {
      // 1. Persistir no IndexedDB em disco
      await saveChunk({
        id: chunkId,
        sessionId,
        sequence: currentSeq,
        blob: blob,
        mimeType: blob.type || "audio/webm",
        createdAt: Date.now(),
        retries: 0,
      });

      // 2. Atualizar timestamps
      this.activeSession.last_chunk_at = new Date().toISOString();
      this.activeSession.last_activity_at = new Date().toISOString();

      // Notificar ouvinte
      this.notifyChunkCaptured(blob, currentSeq);

      // 3. Disparar processamento da fila sequencial (1 chunk por vez)
      this.triggerUploadQueue();
    } catch (err) {
      console.error("🚨 [RecordingEngine] Erro crítico ao persistir chunk no IndexedDB:", err);
    }
  }

  /**
   * Disparar fila de upload do IndexedDB
   */
  private triggerUploadQueue() {
    if (!this.activeSession) return;
    const meetingId = this.activeSession.meeting_id;

    void processUploadQueue({
      targetSessionId: meetingId,
      onChunkTranscribed: (text, segments) => {
        if (!this.activeSession) return;
        const currentDraft = this.activeSession.transcript_draft || "";
        const updatedDraft = currentDraft ? `${currentDraft}\n${text}` : text;
        this.activeSession.transcript_draft = updatedDraft;
        this.notifyChunkTranscribed(text, segments);
        saveActiveSessionToIndexedDB(this.activeSession);
      },
    });
  }

  /**
   * Trata interrupção de entrada de áudio
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
   * Calcular duração real da reunião em segundos
   */
  public getElapsedSeconds(): number {
    if (!this.activeSession) return 0;

    const startMs = this.activeSession.started_at_ms || new Date(this.activeSession.started_at).getTime();
    const accumulatedPausedMs = this.activeSession.accumulated_paused_ms || 0;

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
    let lastSec = -1;
    this.timerInterval = setInterval(() => {
      if (this.activeSession && (this.activeSession.status === "recording" || this.activeSession.status === "background")) {
        const sec = this.getElapsedSeconds();
        if (sec !== lastSec) {
          lastSec = sec;
          this.notifyTimerTick(sec);
        }
      }
    }, 1000);
  }

  /**
   * Loop de sincronização de heartbeat (a cada 10 segundos)
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
   * Monitor de Memória RAM em Development (usando performance.memory)
   */
  private startMemoryMonitor() {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);

    this.memoryMonitorInterval = setInterval(async () => {
      if (!this.activeSession || this.activeSession.status === "finished") return;

      const memory = (performance as any).memory;
      const pendingCount = await countChunks(this.activeSession.meeting_id);

      if (memory) {
        console.log("📊 [Recorder Memory Monitor]", {
          sessionId: this.activeSession.meeting_id,
          sequence: this.sequenceNumber,
          pendingIndexedDBChunks: pendingCount,
          recorderState: this.mediaRecorder?.state || "inactive",
          streamActive: this.mediaStream?.active ?? false,
          audioContextState: this.audioContext?.state || "none",
          usedHeapMB: Math.round(memory.usedJSHeapSize / 1024 / 1024),
          totalHeapMB: Math.round(memory.totalJSHeapSize / 1024 / 1024),
        });
      }
    }, 15000);
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
    if (isSupabaseConfigured()) {
      const remote = await fetchActiveMeetingFromSupabase(this.activeSession.meeting_id);
      if (remote) {
        if (remote.transcript_draft) this.activeSession.transcript_draft = remote.transcript_draft;
        if (remote.speaker_map) this.activeSession.speaker_map = remote.speaker_map;
      }
    }
    await this.persistCurrentState();
  }

  /**
   * Pausar gravação temporariamente
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
   * Retomar gravação pausada
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
   * Atualizar rascunho da transcrição em texto puro (sem guardar blobs)
   */
  public updateTranscriptDraft(rawText: string, speakerMap?: Record<string, string>) {
    if (!this.activeSession) return;
    this.activeSession.transcript_draft = rawText;
    if (speakerMap) this.activeSession.speaker_map = speakerMap;
    saveActiveSessionToIndexedDB(this.activeSession);
  }

  /**
   * Centralizada: Destruição e Liberação de Recursos de Áudio
   */
  private async cleanupRecordingResources(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }
    this.mediaRecorder = null;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioSourceNode) {
      try {
        this.audioSourceNode.disconnect();
      } catch (e) {}
      this.audioSourceNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch (e) {}
      this.analyserNode = null;
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        await this.audioContext.close();
      } catch (e) {}
    }
    this.audioContext = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.mediaStream = null;
    }

    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);

    releaseScreenWakeLock();
    stopAudioKeepAlive();
    destroyUploader();
    this.revokeAllObjectURLs();
  }

  /**
   * FUNÇÃO CENTRALIZADA: finishMeeting()
   * Encerra gravação, drena chunks pendentes e limpa recursos sem criar array de Blobs em RAM.
   */
  public async finishMeeting(): Promise<{
    meetingId: string;
    durationSeconds: number;
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

    console.log("🏁 [RecordingEngine] Encerrando gravação sem acúmulo de memória:", finalMeetingId);

    this.activeSession.status = "finishing";
    this.notifyStatusChange();

    // 1. Limpar recursos e gravadores de áudio
    await this.cleanupRecordingResources();

    // 2. Drenar quaisquer chunks pendentes no IndexedDB
    await processUploadQueue({ targetSessionId: finalMeetingId });

    // 3. Marcar reunião como finalizada e limpar fila do IndexedDB
    this.activeSession.status = "finished";
    this.activeSession.ended_at = new Date().toISOString();

    await closeActiveMeetingInSupabase(finalMeetingId);
    await clearActiveSessionInIndexedDB(finalMeetingId);
    await clearSessionChunks(finalMeetingId);

    const result = {
      meetingId: finalMeetingId,
      durationSeconds: finalDuration,
      transcriptDraft: finalTranscript,
      speakerMap: finalSpeakerMap,
    };

    this.notifyStatusChange();
    this.activeSession = null;

    return result;
  }

  public getActiveSession(): ActiveMeetingSessionState | null {
    return this.activeSession;
  }

  public isRecordingActive(): boolean {
    return !!this.activeSession && this.activeSession.status !== "finished" && this.activeSession.status !== "idle";
  }

  public hasLiveRecorder(): boolean {
    return !!this.mediaRecorder && (this.mediaRecorder.state === "recording" || this.mediaRecorder.state === "paused");
  }

  public async cancelActiveSession(): Promise<void> {
    if (this.activeSession) {
      const meetingId = this.activeSession.meeting_id;
      await this.cleanupRecordingResources();
      await closeActiveMeetingInSupabase(meetingId);
      await clearActiveSessionInIndexedDB(meetingId);
      await clearSessionChunks(meetingId);
      this.activeSession = null;
      this.notifyStatusChange();
    }
  }
}

export const recordingEngine = new RecordingEngineService();
