import {
  ActiveMeetingSessionState,
  ActiveMeetingEngineStatus,
  MeetingSourceType,
  InterruptionGap,
  VisualRecordingState,
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
  getAllSessionChunksOrdered,
  getSessionChunkStats,
} from "@/lib/recording/chunkStore";
import {
  processUploadQueue,
  destroyUploader,
  subscribeUploaderState,
  UploaderSyncState,
} from "@/lib/recording/chunkUploader";
import {
  processAudioTranscription,
  getActiveApiKeys,
  hasConfiguredApiKey,
} from "@/lib/ai";
import {
  syncActiveMeetingToSupabase,
  fetchActiveMeetingFromSupabase,
  closeActiveMeetingInSupabase,
  saveLiveTranscriptToSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { getCurrentAccount } from "@/lib/auth/accountSystem";
import { isDeletedMeeting, saveLocalMeeting } from "@/lib/storage/mockStorage";
import {
  requestScreenWakeLock,
  releaseScreenWakeLock,
  startAudioKeepAlive,
  stopAudioKeepAlive,
  updateBrowserBackgroundSessionIndicator,
  clearBrowserBackgroundSessionIndicator,
} from "@/lib/audio/recordingKeepAlive";

export interface RecordingEngineListeners {
  onStatusChange?: (status: ActiveMeetingEngineStatus, session: ActiveMeetingSessionState | null) => void;
  onTimerTick?: (seconds: number) => void;
  onChunkCaptured?: (blob: Blob, sequenceNumber: number) => void;
  onChunkTranscribed?: (text: string, segments: any[]) => void;
  onSourceInterrupted?: (reason: string) => void;
  onSyncStateChange?: (syncState: UploaderSyncState) => void;
  onError?: (err: Error) => void;
}

const CHUNK_DURATION_MS = 5000;
// Limite para detectar suspensão silenciosa do microfone pelo SO em segundo plano (ex: 15s sem receber chunk de 5s)
const OS_SUSPENSION_GAP_THRESHOLD_MS = 15000;

export function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/aac",
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    } catch {}
  }
  return "";
}

function formatSecondsShort(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

class RecordingEngineService {
  private activeSession: ActiveMeetingSessionState | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private sequenceNumber: number = 0;
  private transcribedSequences: Set<string> = new Set();

  // Recursos de Áudio e Visualização (AudioContext, AnalyserNode, AnimationFrame)
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private audioSourceNode: MediaStreamAudioSourceNode | null = null;
  private animationFrameId: number | null = null;
  private objectUrlsToRevoke: Set<string> = new Set();

  private timerInterval: NodeJS.Timeout | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private watchdogInterval: NodeJS.Timeout | null = null;
  private memoryMonitorInterval: NodeJS.Timeout | null = null;
  private pendingChunkWrites = new Set<Promise<void>>();
  private microphoneRecovery: Promise<void> | null = null;
  private lastSavedMeetingId: string | null = null;

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
    this.updateTabAndMediaSession();
    this.listeners.forEach((l) => l.onStatusChange?.(this.activeSession?.status || "idle", this.activeSession));
  }

  private notifyTimerTick(sec: number) {
    this.updateTabAndMediaSession(sec);
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
   * Calcula o estado visual oficial (5 estados obrigatórios da especificação)
   */
  public getVisualState(): {
    state: VisualRecordingState;
    label: string;
    detail: string;
  } {
    if (!this.activeSession) {
      if (this.lastSavedMeetingId) {
        return {
          state: "saved",
          label: "✅ Gravação salva",
          detail: "Todos os segmentos de áudio foram salvos e consolidados com segurança.",
        };
      }
      return {
        state: "idle",
        label: "Pronto para gravar",
        detail: "Aguardando início da gravação.",
      };
    }

    const s = this.activeSession;

    if (s.status === "finished") {
      return {
        state: "saved",
        label: "✅ Gravação salva",
        detail: "Gravação concluída e armazenada com sucesso.",
      };
    }

    if (s.status === "finishing") {
      return {
        state: "syncing",
        label: "☁️ Sincronizando áudio",
        detail: "Consolidando e sincronizando os últimos segmentos de áudio...",
      };
    }

    if (
      s.status === "interrupted" ||
      s.source_status === "ended" ||
      s.source_status === "interrupted" ||
      s.source_status === "muted" ||
      s.auto_paused_reason === "mic_mute" ||
      s.auto_paused_reason === "os_suspended"
    ) {
      return {
        state: "interrupted",
        label: "⚠️ Captura interrompida",
        detail:
          s.auto_paused_reason === "mic_mute"
            ? "O microfone foi silenciado ou suspenso temporariamente pelo sistema operacional."
            : "A captura de áudio foi interrompida pelo navegador ou sistema operacional. O áudio gravado até aqui está salvo.",
      };
    }

    if (s.recorder_status === "paused") {
      return {
        state: "paused",
        label: "⏸️ Pausado",
        detail: "Gravação pausada pelo usuário.",
      };
    }

    if (s.status === "reconnecting" || (s.is_syncing_audio && (s.pending_sync_chunks || 0) > 1)) {
      return {
        state: "syncing",
        label: "☁️ Sincronizando áudio",
        detail: navigator.onLine
          ? `Sincronizando segmentos de áudio (${s.pending_sync_chunks || 1} pendentes)...`
          : `Sem internet no momento — ${s.total_chunks_saved || 0} segmentos protegidos no IndexedDB aguardando conexão.`,
      };
    }

    return {
      state: "recording",
      label: "🔴 Gravando",
      detail:
        s.status === "background"
          ? "Gravando continuamente em segundo plano."
          : "Capturando áudio continuamente e salvando segmentos no IndexedDB.",
    };
  }

  private updateTabAndMediaSession(elapsedSec?: number) {
    if (typeof window === "undefined") return;
    if (!this.activeSession) {
      if (!this.lastSavedMeetingId) {
        clearBrowserBackgroundSessionIndicator();
      }
      return;
    }
    const visual = this.getVisualState();
    const sec = elapsedSec !== undefined ? elapsedSec : this.getElapsedSeconds();
    updateBrowserBackgroundSessionIndicator({
      title: this.activeSession.title || "Reunião",
      visualState: visual.state,
      elapsedFormatted: formatSecondsShort(sec),
      onPause: () => this.pauseRecording("user"),
      onResume: () => this.resumeRecording(),
    });
  }

  /**
   * Registra um intervalo de interrupção (quando o SO suspende/muta o microfone)
   * garantindo transparência total ao usuário sobre possíveis trechos perdidos.
   */
  private openInterruptionGap(
    reason: InterruptionGap["reason"],
    message: string,
    customStartMs?: number
  ) {
    if (!this.activeSession) return;
    if (!this.activeSession.interruption_gaps) {
      this.activeSession.interruption_gaps = [];
    }
    const existingOpen = this.activeSession.interruption_gaps.find((g) => !g.ended_at);
    if (existingOpen) return;

    const startMs = customStartMs || Date.now();
    this.activeSession.interruption_gaps.push({
      id: `gap_${startMs}`,
      started_at: new Date(startMs).toISOString(),
      started_at_ms: startMs,
      reason,
      message,
    });
  }

  private closeOpenInterruptionGaps() {
    if (!this.activeSession || !this.activeSession.interruption_gaps) return;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    for (const gap of this.activeSession.interruption_gaps) {
      if (!gap.ended_at) {
        gap.ended_at = nowIso;
        gap.ended_at_ms = nowMs;
        gap.duration_seconds = Math.max(1, Math.round((nowMs - gap.started_at_ms) / 1000));
      }
    }
  }

  /**
   * Verifica a integridade real do MediaStream e MediaRecorder
   * Nunca afirma que o áudio está sendo capturado se o SO tiver suspendido ou encerrado a trilha.
   */
  public verifyCaptureHealth(): boolean {
    if (!this.activeSession || this.activeSession.status === "finished" || this.activeSession.status === "finishing") {
      return false;
    }

    const tracks = this.mediaStream ? this.mediaStream.getAudioTracks() : [];
    const hasLiveTrack = tracks.length > 0 && tracks.some((t) => t.readyState === "live" && t.enabled);
    const allMuted = tracks.length > 0 && tracks.every((t) => t.muted);

    if (!this.mediaStream || !this.mediaStream.active || !hasLiveTrack) {
      if (this.activeSession.status !== "interrupted") {
        this.handleSourceEnded("O sistema operacional ou navegador encerrou o acesso ao microfone.");
      }
      return false;
    }

    if (allMuted) {
      if (this.activeSession.source_status !== "muted") {
        this.activeSession.source_status = "muted";
        this.activeSession.status = "interrupted";
        this.openInterruptionGap(
          "track_muted",
          "O microfone foi silenciado/suspenso temporariamente pelo sistema operacional (ex: chamada ou segundo plano)."
        );
        if (this.activeSession.recorder_status === "recording") {
          this.pauseRecording("mic_mute");
        } else {
          this.notifySourceInterrupted("Microfone silenciado pelo sistema operacional.");
          this.notifyStatusChange();
        }
      }
      return false;
    }

    if (this.activeSession.source_status === "muted" && this.activeSession.auto_paused_reason === "mic_mute") {
      this.resumeRecording();
    }

    // Se o gravador deveria estar gravando mas ficou inativo inesperadamente
    if (
      this.activeSession.recorder_status === "recording" &&
      (!this.mediaRecorder || this.mediaRecorder.state === "inactive")
    ) {
      this.handleSourceEnded("O gravador de áudio foi interrompido pelo navegador.");
      return false;
    }

    // Verificar se houve um gap silencioso de suspensão do SO (ex: > 15s sem produzir chunks enquanto recording)
    const lastChunkMs = this.activeSession.last_chunk_at_ms || this.activeSession.started_at_ms;
    const nowMs = Date.now();
    if (
      this.activeSession.recorder_status === "recording" &&
      this.mediaRecorder?.state === "recording" &&
      nowMs - lastChunkMs > OS_SUSPENSION_GAP_THRESHOLD_MS
    ) {
      // Solicitar flush imediato ao MediaRecorder para confirmar se ele ainda está vivo
      try {
        this.mediaRecorder.requestData();
      } catch {
        this.handleSourceEnded("Captura suspensa pelo sistema operacional.");
        return false;
      }
    }

    return true;
  }

  /**
   * Inicializar ouvintes globais de visibilidade, online/offline, pagehide, focus e beforeunload
   */
  private initGlobalEventListeners() {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    // Subscrever ao estado da fila de sincronização de chunks
    subscribeUploaderState((syncState) => {
      if (this.activeSession) {
        this.activeSession.is_syncing_audio = syncState.isSyncing;
        this.activeSession.pending_sync_chunks = syncState.pendingCount;
        this.activeSession.synced_chunks_count = syncState.syncedCount;
        this.activeSession.total_chunks_saved = Math.max(
          this.sequenceNumber,
          syncState.totalCount
        );
        if (syncState.lastSyncedAt) {
          this.activeSession.last_synced_at = syncState.lastSyncedAt;
        }
        this.listeners.forEach((l) => l.onSyncStateChange?.(syncState));
        this.notifyStatusChange();
      }
    });

    // Page Visibility API Handler:
    // Requisito 1 e 3: NÃO interromper nem pausar automaticamente a gravação quando ocorrer visibilitychange!
    document.addEventListener("visibilitychange", async () => {
      if (!this.activeSession || this.activeSession.status === "finished" || this.activeSession.status === "finishing") {
        return;
      }

      if (document.visibilityState === "hidden") {
        console.log("📍 [RecordingEngine] Aba em segundo plano — mantendo gravação contínua ativa.");
        this.activeSession.last_activity_at = new Date().toISOString();

        // Se está gravando ativamente, faz flush preventivo do buffer atual para o IndexedDB
        // mas MANTÉM o MediaRecorder gravando continuamente em segundo plano!
        if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
          if (this.activeSession.source_status === "active") this.activeSession.status = "background";
          try {
            this.mediaRecorder.requestData();
          } catch {}
        }

        await this.persistCurrentState();
        this.notifyStatusChange();
      } else if (document.visibilityState === "visible") {
        console.log("👁️ [RecordingEngine] Aba retornou ao primeiro plano — verificando integridade da captura.");
        this.activeSession.last_activity_at = new Date().toISOString();

        // Sincronizar o cronômetro imediatamente com o relógio real (Date.now())
        this.notifyTimerTick(this.getElapsedSeconds());

        const isHealthy = this.verifyCaptureHealth();
        if (!isHealthy) void this.recoverMicrophone(true).catch(console.warn);
        if (isHealthy && this.activeSession.status === "background") {
          this.activeSession.status = "recording";
        }

        if (isHealthy && this.activeSession.recorder_status === "recording") {
          void requestScreenWakeLock();
        }

        await this.syncWithBackendAndLocal();
        this.notifyStatusChange();
      }
    });

    // Sincronizar cronômetro e estado ao focar na janela ou restaurar página do bfcache
    const handleWindowFocusOrShow = () => {
      if (!this.activeSession || this.activeSession.status === "finished") return;
      this.notifyTimerTick(this.getElapsedSeconds());
      const isHealthy = this.verifyCaptureHealth();
      if (document.visibilityState !== "visible") return;
      if (!isHealthy) {
        void this.recoverMicrophone(true).catch(console.warn);
      } else if (this.activeSession.recorder_status === "recording") {
        void requestScreenWakeLock();
      }
    };
    window.addEventListener("focus", handleWindowFocusOrShow);
    window.addEventListener("pageshow", handleWindowFocusOrShow);

    // Requisito 4: Avisar antes de fechar ou atualizar uma página com gravação ativa
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (this.activeSession && this.activeSession.status !== "finished") {
        // Fazer flush imediato do segmento atual para o IndexedDB
        if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
          try {
            this.mediaRecorder.requestData();
          } catch {}
        }
        this.activeSession.last_activity_at = new Date().toISOString();
        void this.persistCurrentState();

        // Acionar confirmação nativa do navegador antes de fechar/recarregar
        e.preventDefault();
        e.returnValue =
          "Há uma gravação de reunião ativa em andamento. Fechar ou atualizar esta página interromperá a captura do microfone.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    window.addEventListener("pagehide", () => {
      if (this.activeSession && this.activeSession.status !== "finished") {
        if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
          try {
            this.mediaRecorder.requestData();
          } catch {}
        }
        this.activeSession.last_activity_at = new Date().toISOString();
        void this.persistCurrentState();
      }
    });

    // Eventos Online / Offline
    window.addEventListener("online", async () => {
      console.log("🌐 [RecordingEngine] Conexão restabelecida. Sincronizando segmentos do IndexedDB...");
      if (this.activeSession && this.activeSession.status === "reconnecting") {
        this.activeSession.status =
          document.visibilityState === "hidden" ? "background" : "recording";
        this.notifyStatusChange();
      }
      this.triggerUploadQueue();
    });

    window.addEventListener("offline", () => {
      console.warn("⚠️ [RecordingEngine] Sem internet. Segmentos continuam sendo salvos localmente no IndexedDB.");
      if (this.activeSession && (this.activeSession.status === "recording" || this.activeSession.status === "background")) {
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

        if (session && session.status !== "finished" && !isDeletedMeeting(session.meeting_id)) {
          console.log("🔄 [RecordingEngine] Reunião interrompida/ativa detectada para recuperação:", session.meeting_id);

          // Recuperar estatísticas reais dos segmentos já armazenados no IndexedDB
          const stats = await getSessionChunkStats(session.meeting_id);
          if (stats.highestSequence > this.sequenceNumber) {
            this.sequenceNumber = stats.highestSequence;
          }
          session.total_chunks_saved = stats.total;
          session.pending_sync_chunks = stats.pending;
          session.synced_chunks_count = stats.synced;

          this.activeSession = session;

          // Se a página foi recarregada/reaberta e não há MediaRecorder vivo em memória,
          // sinalizar honestamente como captura interrompida (sem iniciar getUserMedia silenciosamente!)
          if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
            session.status = "interrupted";
            session.source_status = "interrupted";
            session.recorder_status = "paused";
            if (!session.paused_at_ms) {
              session.paused_at_ms = session.last_chunk_at_ms || Date.now();
            }
            this.openInterruptionGap(
              "page_reloaded",
              "A página foi recarregada ou fechada durante a gravação. Todos os segmentos anteriores foram recuperados do IndexedDB."
            );
          }

          // Drenar eventuais chunks pendentes salvos no IndexedDB antes da interrupção
          this.triggerUploadQueue();

          this.startTimerLoop();
          this.startSyncHeartbeat();
          this.startWatchdogLoop();
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
      } catch {}
    });
    this.objectUrlsToRevoke.clear();
  }

  /**
   * Iniciar uma nova gravação (ou reconectar uma sessão interrompida mantendo os segmentos anteriores)
   */
  public async startRecording(params: {
    meetingId: string;
    title: string;
    sourceType: MeetingSourceType;
    stream: MediaStream;
    chunkIntervalMs?: number;
    participants?: string;
  }): Promise<ActiveMeetingSessionState> {
    const { meetingId, title, sourceType, stream } = params;

    this.lastSavedMeetingId = null;

    // Prevenção de dupla gravação / limpar gravadores anteriores
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      if (this.activeSession?.meeting_id !== meetingId || this.activeSession.status !== "interrupted") {
        stream.getTracks().forEach((track) => track.stop());
        return this.activeSession!;
      }
      // O gravador anterior pode continuar pausado mesmo após perder o microfone.
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.onerror = null;
      this.mediaRecorder.stop();
    }

    if (this.mediaStream && this.mediaStream !== stream) {
      for (const track of this.mediaStream.getTracks()) {
        track.onended = null;
        track.onmute = null;
        track.onunmute = null;
        track.stop();
      }
    }

    const previousSession = this.activeSession;
    const isResumingInterrupted = previousSession?.meeting_id === meetingId;
    const existingStats = await getSessionChunkStats(meetingId);
    if (isResumingInterrupted && (this.activeSession !== previousSession || previousSession.status === "finishing")) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("A reunião foi encerrada durante a reconexão.");
    }

    if (isResumingInterrupted || existingStats.highestSequence > 0) {
      this.sequenceNumber = Math.max(this.sequenceNumber, existingStats.highestSequence);
    } else {
      this.sequenceNumber = 0;
      this.transcribedSequences.clear();
    }

    const sessionId = isResumingInterrupted
      ? this.activeSession!.session_id
      : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const currentAccount = getCurrentAccount();

    if (isResumingInterrupted) {
      this.closeOpenInterruptionGaps();
    }

    const existingPausedMs = isResumingInterrupted
      ? (this.activeSession!.accumulated_paused_ms || 0) +
        (this.activeSession!.paused_at_ms ? Math.max(0, nowMs - this.activeSession!.paused_at_ms) : 0)
      : 0;

    const sessionState: ActiveMeetingSessionState = {
      meeting_id: meetingId,
      session_id: sessionId,
      user_id: currentAccount?.id || this.activeSession?.user_id || "u-001",
      title: title || this.activeSession?.title || "Reunião Sem Título",
      participants: params.participants || (isResumingInterrupted ? this.activeSession?.participants : undefined),
      source_type: sourceType,
      status: document.visibilityState === "hidden" ? "background" : "recording",
      started_at: isResumingInterrupted ? this.activeSession!.started_at : nowIso,
      started_at_ms: isResumingInterrupted ? this.activeSession!.started_at_ms : nowMs,
      last_chunk_at: nowIso,
      last_chunk_at_ms: nowMs,
      last_activity_at: nowIso,
      source_status: "active",
      recorder_status: "recording",
      accumulated_paused_ms: existingPausedMs,
      paused_at_ms: undefined,
      auto_paused_reason: null,
      wake_lock_enabled: true,
      transcript_draft: isResumingInterrupted ? this.activeSession!.transcript_draft || "" : "",
      speaker_map: isResumingInterrupted
        ? this.activeSession!.speaker_map || { "Participante 1": "Participante 1" }
        : { "Participante 1": "Participante 1" },
      segments_draft: isResumingInterrupted ? this.activeSession!.segments_draft || [] : [],
      interruption_gaps: isResumingInterrupted ? this.activeSession!.interruption_gaps || [] : [],
      total_chunks_saved: existingStats.total,
      synced_chunks_count: existingStats.synced,
      pending_sync_chunks: existingStats.pending,
      is_syncing_audio: false,
    };

    // Criar/atualizar registro inicial da reunião e transcrição no Supabase vinculado à conta da pessoa
    saveLiveTranscriptToSupabase({
      meetingId,
      userId: currentAccount?.id,
      userEmail: currentAccount?.email,
      title: sessionState.title,
      sourceType,
      durationSeconds: this.getElapsedSeconds(),
      rawText: sessionState.transcript_draft || "Gravação iniciada...",
      speakerMap: sessionState.speaker_map,
      segments: sessionState.segments_draft,
    }).catch(() => {});

    this.activeSession = sessionState;
    this.mediaStream = stream;
    startAudioKeepAlive();

    // Requisito 1: Monitorar os eventos mute, unmute, ended e error das trilhas de áudio
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        console.warn("🚨 [RecordingEngine] AudioTrack encerrada (ended) pelo sistema/usuário.");
        this.openInterruptionGap(
          "track_ended",
          "A trilha do microfone foi encerrada pelo navegador ou sistema operacional."
        );
        this.handleSourceEnded("Faixa de áudio encerrada pelo dispositivo ou navegador.");
      };

      track.onmute = () => {
        console.warn("⚠️ [RecordingEngine] AudioTrack silenciada (mute) pelo sistema operacional.");
        if (!this.activeSession || this.activeSession.status === "finished" || this.activeSession.status === "finishing") return;

        this.activeSession.source_status = "muted";
        this.activeSession.status = "interrupted";
        this.openInterruptionGap(
          "track_muted",
          "Microfone temporariamente suspenso pelo sistema operacional (ex: chamada recebida, bloqueio de tela ou foco de áudio)."
        );

        if (this.activeSession.recorder_status === "recording") {
          this.pauseRecording("mic_mute");
        } else {
          this.persistCurrentState();
          this.notifySourceInterrupted("Microfone suspenso temporariamente pelo sistema.");
          this.notifyStatusChange();
        }
      };

      track.onunmute = () => {
        console.log("🔊 [RecordingEngine] AudioTrack restaurada (unmute) pelo sistema operacional.");
        if (!this.activeSession || this.activeSession.status === "finished" || this.activeSession.status === "finishing") return;

        this.closeOpenInterruptionGaps();
        this.activeSession.source_status = "active";

        if (
          this.activeSession.recorder_status === "paused" &&
          (this.activeSession.auto_paused_reason === "mic_mute" ||
            this.activeSession.auto_paused_reason === "os_suspended")
        ) {
          this.resumeRecording();
        } else {
          this.activeSession.status = document.visibilityState === "hidden" ? "background" : "recording";
          this.persistCurrentState();
          this.notifyStatusChange();
        }
      };

      track.addEventListener("error", (errEvent: any) => {
        if (this.mediaStream !== stream) return;
        console.error("🚨 [RecordingEngine] Erro na trilha de áudio:", errEvent);
        this.openInterruptionGap(
          "recorder_error",
          "Erro reportado pelo hardware/driver de captura de áudio."
        );
        this.handleSourceEnded("Erro na trilha de captura de áudio.");
      });
    });

    // Configurar MediaRecorder de 128 kbps Opus/WebM (ou MP4/AAC no Safari)
    const mimeType = getSupportedMimeType();
    const recorderOptions: MediaRecorderOptions = {
      audioBitsPerSecond: 128000,
    };
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
    }

    const recorder = new MediaRecorder(stream, recorderOptions);
    this.mediaRecorder = recorder;

    recorder.ondataavailable = async (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return;
      const writing = this.persistAndUploadChunk(event.data);
      this.pendingChunkWrites.add(writing);
      try {
        await writing;
      } finally {
        this.pendingChunkWrites.delete(writing);
      }
    };

    recorder.onerror = (e: any) => {
      console.error("Erro no MediaRecorder:", e);
      this.openInterruptionGap(
        "recorder_error",
        "O MediaRecorder encontrou um erro durante a codificação de áudio."
      );
      this.handleSourceEnded("Falha no gravador de áudio do navegador.");
      this.notifyError(new Error("Falha no gravador de áudio do navegador."));
    };

    recorder.onstop = () => {
      // Se o MediaRecorder parou sem a sessão estar finalizando, o navegador/SO encerrou a captura
      if (
        this.activeSession &&
        this.activeSession.status !== "finishing" &&
        this.activeSession.status !== "finished"
      ) {
        console.warn("⚠️ [RecordingEngine] MediaRecorder parou inesperadamente.");
        this.openInterruptionGap(
          "os_suspended",
          "A gravação foi interrompida pelo sistema operacional."
        );
        this.handleSourceEnded("Captura encerrada pelo sistema operacional.");
      }
    };

    recorder.start(CHUNK_DURATION_MS);
    void requestScreenWakeLock();

    await this.persistCurrentState();
    this.startTimerLoop();
    this.startSyncHeartbeat();
    this.startWatchdogLoop();
    this.startMemoryMonitor();
    this.notifyStatusChange();

    return sessionState;
  }

  /**
   * Persistir chunk no IndexedDB e disparar uploader (ZERO acúmulo de Blob em RAM)
   */
  private async persistAndUploadChunk(blob: Blob) {
    if (!this.activeSession) return;

    const nowMs = Date.now();
    // The browser can delay delivery of chunks while continuing to capture.
    this.sequenceNumber += 1;
    const currentSeq = this.sequenceNumber;
    const sessionId = this.activeSession.meeting_id;
    const chunkId = `${sessionId}-${currentSeq}`;
    const elapsedSec = this.getElapsedSeconds();

    try {
      // 1. Persistir no IndexedDB em disco com ID determinístico
      await saveChunk({
        id: chunkId,
        sessionId,
        sequence: currentSeq,
        blob: blob,
        mimeType: blob.type || getSupportedMimeType() || "audio/webm",
        createdAt: nowMs,
        retries: 0,
        durationSeconds: CHUNK_DURATION_MS / 1000,
        timestampStart: Math.max(0, elapsedSec - CHUNK_DURATION_MS / 1000),
      });

      // 2. Atualizar timestamps e contadores
      this.activeSession.last_chunk_at = new Date(nowMs).toISOString();
      this.activeSession.last_chunk_at_ms = nowMs;
      this.activeSession.last_activity_at = new Date(nowMs).toISOString();
      this.activeSession.total_chunks_saved = currentSeq;

      // Sincronizar o cronômetro também a cada evento real do MediaRecorder (funciona mesmo com setInterval em throttling!)
      this.notifyTimerTick(elapsedSec);

      // Persistir estado da sessão ativa no IndexedDB
      await saveActiveSessionToIndexedDB(this.activeSession);

      // Notificar ouvinte
      this.notifyChunkCaptured(blob, currentSeq);

      // 3. Disparar processamento da fila sequencial (1 chunk por vez)
      this.triggerUploadQueue();
    } catch (err) {
      console.error("🚨 [RecordingEngine] Erro crítico ao persistir chunk no IndexedDB:", err);
    }
  }

  /**
   * Disparar fila de upload do IndexedDB e salvar transcrição progressiva sem duplicidade
   */
  private handleChunkTranscriptionResult(text: string, segments: any[], sequenceNumber?: number) {
    if (!this.activeSession) return;

    // Prevenção de duplicidade de transcrição para o mesmo segmento
    if (sequenceNumber !== undefined) {
      const dedupKey = `${this.activeSession.meeting_id}-${sequenceNumber}`;
      if (this.transcribedSequences.has(dedupKey)) {
        return;
      }
      this.transcribedSequences.add(dedupKey);
    }

    const currentDraft = this.activeSession.transcript_draft || "";
    const updatedDraft = currentDraft ? `${currentDraft}\n${text}` : text;
    this.activeSession.transcript_draft = updatedDraft;

    const currentSegs = this.activeSession.segments_draft || [];
    const elapsedOffset =
      sequenceNumber !== undefined
        ? Math.max(0, (sequenceNumber - 1) * (CHUNK_DURATION_MS / 1000))
        : Math.max(0, this.getElapsedSeconds() - 5);

    const mappedNewSegs = (segments && segments.length > 0
      ? segments
      : [{ start_time: 0, end_time: 5, speaker: "Participante 1", text }]
    ).map((s: any, idx: number) => ({
      id: `seg-${this.activeSession!.meeting_id}-${sequenceNumber ?? currentSegs.length}-${idx}`,
      transcript_id: `t-${this.activeSession!.meeting_id}`,
      meeting_id: this.activeSession!.meeting_id,
      start_time: Number(s.start_time || 0) + elapsedOffset,
      end_time: Number(s.end_time || 5) + elapsedOffset,
      speaker: s.speaker || "Participante 1",
      text: s.text || text,
    }));

    this.activeSession.segments_draft = [...currentSegs, ...mappedNewSegs];
    this.notifyChunkTranscribed(text, segments);
    saveActiveSessionToIndexedDB(this.activeSession);

    const acc = getCurrentAccount();
    const durationNow = this.getElapsedSeconds();

    // Salvar checkpoint periódico local (IndexedDB + LocalStorage) para recuperação automática em caso de queda
    saveLocalMeeting({
      meeting: {
        id: this.activeSession.meeting_id,
        user_id: acc?.id || this.activeSession.user_id || "u-001",
        user_email: acc?.email,
        title: this.activeSession.title,
        description: "Gravação em andamento (salvamento periódico automático).",
        meeting_date: this.activeSession.started_at,
        duration_seconds: durationNow,
        source_type: this.activeSession.source_type,
        status: "TRANSCREVENDO",
        error_message: null,
        tags: ["Salvamento Automático"],
        created_at: this.activeSession.started_at,
        updated_at: new Date().toISOString(),
      },
      transcript: {
        id: `t-${this.activeSession.meeting_id}`,
        meeting_id: this.activeSession.meeting_id,
        raw_text: updatedDraft,
        speaker_map: this.activeSession.speaker_map || { "Participante 1": "Participante 1" },
        segments: this.activeSession.segments_draft || [],
      },
      highlights: [],
      decisions: [],
      tasks: [],
      pending_items: [],
      risks: [],
      opportunities: [],
      values: [],
      dates: [],
      quotes: [],
      next_steps_agreed: [],
      next_steps_ai_suggestions: [],
    });

    saveLiveTranscriptToSupabase({
      meetingId: this.activeSession.meeting_id,
      userId: acc?.id || this.activeSession.user_id,
      userEmail: acc?.email,
      title: this.activeSession.title,
      sourceType: this.activeSession.source_type,
      durationSeconds: durationNow,
      rawText: updatedDraft,
      speakerMap: this.activeSession.speaker_map,
      segments: this.activeSession.segments_draft,
    }).catch(() => {});
  }

  public triggerUploadQueue() {
    if (!this.activeSession) return;
    const meetingId = this.activeSession.meeting_id;

    void processUploadQueue({
      targetSessionId: meetingId,
      onChunkTranscribed: (text, segments, sequenceNumber) => {
        this.handleChunkTranscriptionResult(text, segments, sequenceNumber);
      },
    });
  }

  /**
   * Trata interrupção real de entrada de áudio
   */
  private handleSourceEnded(reason: string) {
    if (!this.activeSession || this.activeSession.status === "finished" || this.activeSession.status === "finishing") {
      return;
    }

    this.activeSession.source_status = "ended";
    this.activeSession.status = "interrupted";
    this.activeSession.recorder_status = "paused";
    if (!this.activeSession.paused_at_ms) {
      this.activeSession.paused_at_ms = Date.now();
    }
    this.activeSession.last_activity_at = new Date().toISOString();

    this.persistCurrentState();
    this.notifySourceInterrupted(reason);
    this.notifyStatusChange();
  }

  /**
   * Calcular duração real da reunião em segundos baseada no relógio monotônico/real (Date.now())
   * sem depender da contagem de ticks do setInterval.
   */
  public getElapsedSeconds(): number {
    if (!this.activeSession) return 0;

    const startMs = this.activeSession.started_at_ms || new Date(this.activeSession.started_at).getTime();
    const accumulatedPausedMs = this.activeSession.accumulated_paused_ms || 0;

    let currentMs = Date.now();
    if (this.activeSession.recorder_status === "paused" || this.activeSession.status === "interrupted") {
      if (this.activeSession.paused_at_ms) {
        currentMs = this.activeSession.paused_at_ms;
      }
    }

    const diffMs = Math.max(0, currentMs - startMs - accumulatedPausedMs);
    return Math.floor(diffMs / 1000);
  }

  /**
   * Loop do cronômetro sincronizado com tempo real
   */
  private startTimerLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    let lastSec = -1;
    this.timerInterval = setInterval(() => {
      if (
        this.activeSession &&
        (this.activeSession.status === "recording" ||
          this.activeSession.status === "background" ||
          this.activeSession.status === "reconnecting")
      ) {
        const sec = this.getElapsedSeconds();
        if (sec !== lastSec) {
          lastSec = sec;
          this.notifyTimerTick(sec);
        }
      }
    }, 500);
  }

  /**
   * Watchdog de integridade de captura (detecta suspensão silenciosa do microfone pelo SO/navegador)
   */
  private startWatchdogLoop() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      if (!this.activeSession || this.activeSession.status === "finished" || this.activeSession.status === "finishing") {
        return;
      }
      this.verifyCaptureHealth();
    }, 4000);
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
   * Monitor de Memória RAM em Development
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
      const session = this.activeSession;
      const remote = await fetchActiveMeetingFromSupabase(session.meeting_id);
      if (this.activeSession !== session) return;
      if (remote) {
        if (remote.transcript_draft && remote.transcript_draft.length > (this.activeSession.transcript_draft || "").length) {
          this.activeSession.transcript_draft = remote.transcript_draft;
        }
        if (remote.speaker_map) this.activeSession.speaker_map = remote.speaker_map;
      }
    }
    await this.persistCurrentState();
  }

  /**
   * Pausar gravação (manual pelo usuário ou automática quando o microfone sofre mute do SO)
   */
  public pauseRecording(reason: "screen_off" | "mic_mute" | "os_suspended" | "user" = "user") {
    if (this.activeSession && this.activeSession.recorder_status !== "paused") {
      if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
        try {
          this.mediaRecorder.requestData();
        } catch {}
        try {
          this.mediaRecorder.pause();
        } catch (e) {
          console.warn("Aviso ao pausar MediaRecorder:", e);
        }
      }
      this.activeSession.recorder_status = "paused";
      this.activeSession.paused_at_ms = Date.now();
      this.activeSession.auto_paused_reason = reason;
      if (reason === "mic_mute" || reason === "os_suspended") {
        this.activeSession.status = "interrupted";
      }
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
      // Verificar se a trilha de áudio ainda está viva antes de retomar
      const tracks = this.mediaStream ? this.mediaStream.getAudioTracks() : [];
      const hasLiveTrack = tracks.some((t) => t.readyState === "live");
      if (hasLiveTrack && tracks.every((t) => t.muted)) return;
      if (!hasLiveTrack || !this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        this.handleSourceEnded("A trilha do microfone foi encerrada pelo sistema. Clique em 'Reconectar áudio' para continuar.");
        return;
      }

      if (this.mediaRecorder.state === "paused" || this.activeSession.auto_paused_reason === "mic_mute") {
        try {
          this.mediaRecorder.resume();
        } catch (e) {
          console.warn("Aviso ao retomar MediaRecorder:", e);
          this.handleSourceEnded("Não foi possível retomar a captura de áudio.");
          return;
        }
      }

      if (this.activeSession.paused_at_ms) {
        const pauseDurationMs = Math.max(0, Date.now() - this.activeSession.paused_at_ms);
        this.activeSession.accumulated_paused_ms = (this.activeSession.accumulated_paused_ms || 0) + pauseDurationMs;
        this.activeSession.paused_at_ms = undefined;
      }

      this.closeOpenInterruptionGaps();
      this.activeSession.recorder_status = "recording";
      this.activeSession.source_status = "active";
      this.activeSession.status = document.visibilityState === "hidden" ? "background" : "recording";
      this.activeSession.auto_paused_reason = null;
      this.activeSession.last_chunk_at_ms = Date.now();
      void requestScreenWakeLock();
      this.persistCurrentState();
      this.notifyStatusChange();
      this.notifyTimerTick(this.getElapsedSeconds());
    }
  }

  public async recoverMicrophone(automatic = false): Promise<void> {
    if (this.microphoneRecovery) return this.microphoneRecovery;

    const session = this.activeSession;
    if (!session || session.source_type === "online_meeting" || session.status !== "interrupted") return;
    if (automatic && (
      !this.mediaStream || session.source_status !== "ended" || session.auto_paused_reason === "user"
    )) return;

    this.microphoneRecovery = (async () => {
      if (automatic) {
        const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName }).catch(() => null);
        if (permission?.state !== "granted" || document.visibilityState !== "visible") return;
      }

      if (this.activeSession !== session || session.status !== "interrupted") return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 },
      });

      if (this.activeSession !== session || session.status !== "interrupted") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      try {
        await this.startRecording({
          meetingId: session.meeting_id,
          title: session.title,
          sourceType: session.source_type,
          stream,
        });
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
      }
    })();

    try {
      await this.microphoneRecovery;
    } finally {
      this.microphoneRecovery = null;
    }
  }

  /**
   * Atualizar rascunho da transcrição em texto puro e sincronizar no Supabase
   */
  public updateTranscriptDraft(rawText: string, speakerMap?: Record<string, string>) {
    if (!this.activeSession) return;
    this.activeSession.transcript_draft = rawText;
    if (speakerMap) this.activeSession.speaker_map = speakerMap;
    saveActiveSessionToIndexedDB(this.activeSession);

    const acc = getCurrentAccount();
    saveLiveTranscriptToSupabase({
      meetingId: this.activeSession.meeting_id,
      userId: acc?.id || this.activeSession.user_id,
      userEmail: acc?.email,
      title: this.activeSession.title,
      sourceType: this.activeSession.source_type,
      durationSeconds: this.getElapsedSeconds(),
      rawText,
      speakerMap: this.activeSession.speaker_map,
      segments: this.activeSession.segments_draft,
    }).catch(() => {});
  }

  /**
   * Centralizada: Destruição e Liberação de Recursos de Áudio
   */
  private async cleanupRecordingResources(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const rec = this.mediaRecorder!;
        const timeout = setTimeout(resolve, 700);
        rec.addEventListener(
          "stop",
          () => {
            clearTimeout(timeout);
            setTimeout(resolve, 150);
          },
          { once: true }
        );
        try {
          rec.stop();
        } catch {
          clearTimeout(timeout);
          resolve();
        }
      });
    }
    this.mediaRecorder = null;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioSourceNode) {
      try {
        this.audioSourceNode.disconnect();
      } catch {}
      this.audioSourceNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {}
      this.analyserNode = null;
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        await this.audioContext.close();
      } catch {}
    }
    this.audioContext = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.onended = null;
          track.onmute = null;
          track.onunmute = null;
          track.stop();
        } catch {}
      });
      this.mediaStream = null;
    }

    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);

    await releaseScreenWakeLock();
    stopAudioKeepAlive();
    clearBrowserBackgroundSessionIndicator();
    this.revokeAllObjectURLs();
  }

  public getSavedChunksCount(): number {
    return this.activeSession?.total_chunks_saved ?? this.sequenceNumber;
  }

  /**
   * FUNÇÃO CENTRALIZADA: finishMeeting()
   * Encerra gravação, drena chunks pendentes e consolida áudio completo no IndexedDB.
   */
  public async finishMeeting(onProgress?: (message: string) => void): Promise<{
    meetingId: string;
    durationSeconds: number;
    transcriptDraft: string;
    canDiscardAudio: boolean;
    transcriptionWarning?: string;
    participants?: string;
    speakerMap: Record<string, string>;
    segmentsDraft: any[];
    interruptionGaps: InterruptionGap[];
  }> {
    if (!this.activeSession) {
      throw new Error("Nenhuma reunião ativa para finalizar.");
    }

    const finalMeetingId = this.activeSession.meeting_id;
    const finalDuration = this.getElapsedSeconds();
    this.closeOpenInterruptionGaps();
    const finalGaps = this.activeSession.interruption_gaps || [];

    console.log("🏁 [RecordingEngine] Encerrando gravação e consolidando segmentos:", finalMeetingId);

    this.activeSession.status = "finishing";
    this.notifyStatusChange();

    // 1. Limpar recursos e aguardar último bloco de áudio do MediaRecorder
    await this.cleanupRecordingResources();
    await Promise.all(this.pendingChunkWrites);

    // 2. Drenar e transcrever todos os chunks pendentes no IndexedDB ANTES de ler a transcrição final
    await processUploadQueue({
      targetSessionId: finalMeetingId,
      onChunkTranscribed: (text, segments, sequenceNumber) => {
        this.handleChunkTranscriptionResult(text, segments, sequenceNumber);
      },
    });

    destroyUploader();

    let finalTranscript = this.activeSession.transcript_draft || "";
    let finalSpeakerMap = this.activeSession.speaker_map || { "Participante 1": "Participante 1" };
    let finalSegments = this.activeSession.segments_draft || [];

    let processedSeconds: number | undefined;
    try {
      const chunks = await getAllSessionChunksOrdered(finalMeetingId);
      if (chunks.length && hasConfiguredApiKey()) {
        const mimeType = chunks[0].mimeType || "audio/webm";
        const audio = new Blob(chunks.map((chunk) => chunk.blob), { type: mimeType });
        const useBatches = audio.size >= 24 * 1024 * 1024 && Boolean(getActiveApiKeys().openaiKey);

        if (useBatches) {
          const { transcribeRecordedAudio } = await import("@/lib/recording/recoverTranscript");
          const { transcript, audioDuration } = await transcribeRecordedAudio(
            audio, finalMeetingId, undefined, finalSpeakerMap,
            (part, total) => onProgress?.(`Transcrevendo o áudio gravado · parte ${part} de ${total}…`)
          );
          if (transcript.raw_text.length >= finalTranscript.trim().length) {
            finalTranscript = transcript.raw_text;
            finalSegments = transcript.segments || [];
            processedSeconds = audioDuration;
          }
        } else if (audio.size < 24 * 1024 * 1024) {
          onProgress?.("Transcrevendo o áudio gravado…");
          const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
          const result = await processAudioTranscription(audio, `reuniao.${extension}`, { refineWithAI: false });
          if (result.raw_text.trim() && result.raw_text.trim().length >= finalTranscript.trim().length) {
            finalTranscript = result.raw_text.trim();
            finalSpeakerMap = result.speaker_map || finalSpeakerMap;
            finalSegments = (result.segments || []).map((section, index) => ({
              ...section,
              id: `seg-${finalMeetingId}-${index}`,
              transcript_id: `t-${finalMeetingId}`,
              meeting_id: finalMeetingId,
            }));
            processedSeconds = result.audio_duration_seconds;
          }
        }
      }
    } catch (error) {
      console.warn("Não foi possível confirmar a transcrição completa; mantendo o texto já salvo.", error);
    }

    const coversRecording = typeof processedSeconds === "number" && Number.isFinite(processedSeconds) &&
      processedSeconds > 0 && Math.abs(processedSeconds - finalDuration) <= 2 &&
      finalSegments.length > 0;
    const canDiscardAudio = finalGaps.length === 0 && coversRecording;
    const transcriptionWarning = finalGaps.length
      ? "O microfone foi interrompido durante a reunião. O texto pode ter lacunas onde o áudio não foi capturado."
      : !coversRecording ? "A transcrição pode estar parcial. Use Recuperar transcrição do áudio se ainda houver áudio salvo neste navegador." : undefined;

    // 5. Marcar reunião como finalizada e limpar fila temporária de chunks
    this.activeSession.status = "finished";
    this.activeSession.ended_at = new Date().toISOString();
    this.lastSavedMeetingId = finalMeetingId;

    await closeActiveMeetingInSupabase(finalMeetingId);
    await clearActiveSessionInIndexedDB(finalMeetingId);
    const result = {
      meetingId: finalMeetingId,
      durationSeconds: finalDuration,
      transcriptDraft: finalTranscript,
      canDiscardAudio,
      transcriptionWarning,
      participants: this.activeSession.participants,
      speakerMap: finalSpeakerMap,
      segmentsDraft: finalSegments,
      interruptionGaps: finalGaps,
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
      this.activeSession.status = "finishing";
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
