import {
  getOldestChunk,
  markChunkProcessed,
  updateChunkFlags,
  incrementChunkRetry,
  countChunks,
  getSessionChunkStats,
} from './chunkStore';
import { uploadAudioChunkDeduplicated, isSupabaseConfigured } from '@/lib/supabase/client';
import { processAudioTranscription, hasConfiguredApiKey } from '@/lib/ai';

export interface UploaderSyncState {
  isSyncing: boolean;
  pendingCount: number;
  syncedCount: number;
  totalCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface UploadQueueOptions {
  targetSessionId?: string;
  onChunkTranscribed?: (text: string, segments: any[], sequenceNumber?: number) => void;
  onSyncStateChange?: (state: UploaderSyncState) => void;
}

let activeUploadPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let currentChunkCallback: ((text: string, segments: any[], sequenceNumber?: number) => void) | undefined = undefined;

const uploaderListeners = new Set<(state: UploaderSyncState) => void>();
const suspendedSessions = new Set<string>();
const sentChunkIdsMemory = new Set<string>();

let currentUploaderState: UploaderSyncState = {
  isSyncing: false,
  pendingCount: 0,
  syncedCount: 0,
  totalCount: 0,
  lastSyncedAt: null,
  lastError: null,
};

function notifyUploaderListeners(next: Partial<UploaderSyncState>) {
  currentUploaderState = { ...currentUploaderState, ...next };
  uploaderListeners.forEach((cb) => {
    try {
      cb(currentUploaderState);
    } catch {}
  });
}

export function getUploaderState(): UploaderSyncState {
  return currentUploaderState;
}

export function subscribeUploaderState(cb: (state: UploaderSyncState) => void): () => void {
  uploaderListeners.add(cb);
  cb(currentUploaderState);
  return () => {
    uploaderListeners.delete(cb);
  };
}

// Cache leve (~200 bytes) do cabeçalho EBML/WebM inicial da sessão para que os chunks 2..N sejam arquivos WebM válidos para o Whisper
const webmHeaderCache = new Map<string, Uint8Array>();

async function ensureValidWebmBlob(sessionId: string, sequence: number, blob: Blob, mimeType: string): Promise<Blob> {
  try {
    const headSlice = await blob.slice(0, Math.min(4096, blob.size)).arrayBuffer();
    const bytes = new Uint8Array(headSlice);

    const hasEbmlHeader =
      bytes.length >= 4 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3;

    if (hasEbmlHeader) {
      // Encontrar início do primeiro Cluster WebM (0x1F 0x43 0xB6 0x75) para guardar o cabeçalho de inicialização
      for (let i = 4; i < bytes.length - 4; i++) {
        if (
          bytes[i] === 0x1f &&
          bytes[i + 1] === 0x43 &&
          bytes[i + 2] === 0xb6 &&
          bytes[i + 3] === 0x75
        ) {
          webmHeaderCache.set(sessionId, bytes.slice(0, i));
          break;
        }
      }
      return blob;
    }

    // Se for chunk >= 2 sem cabeçalho EBML, prefixar o cabeçalho EBML da sessão
    const cachedHeader = webmHeaderCache.get(sessionId);
    if (cachedHeader && cachedHeader.byteLength > 0) {
      return new Blob([cachedHeader.buffer as ArrayBuffer, blob], { type: mimeType || 'audio/webm' });
    }
  } catch {}
  return blob;
}

async function syncChunkToServerDeduplicated(chunk: {
  id: string;
  sessionId: string;
  sequence: number;
  mimeType: string;
  blob: Blob;
  createdAt: number;
  durationSeconds?: number;
  timestampStart?: number;
}): Promise<boolean> {
  // Prevenção de duplicidade em memória na mesma sessão
  if (sentChunkIdsMemory.has(chunk.id)) {
    return true;
  }

  let serverOk = false;

  // 1. Sincronizar com endpoint da aplicação (/api/cloud-sync) com chave de idempotência chunk.id
  if (typeof window !== 'undefined') {
    try {
      const response = await fetch('/api/cloud-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chunk: {
            id: chunk.id,
            sessionId: chunk.sessionId,
            sequence: chunk.sequence,
            mimeType: chunk.mimeType,
            sizeBytes: chunk.blob.size,
            createdAt: chunk.createdAt,
            durationSeconds: chunk.durationSeconds || 5.0,
            timestampStart: chunk.timestampStart ?? Math.max(0, (chunk.sequence - 1) * 5.0),
          },
        }),
      });
      if (response.ok) {
        serverOk = true;
      }
    } catch {
      // Falha de rede ao contatar o servidor
      serverOk = false;
    }
  } else {
    serverOk = true;
  }

  // 2. Se o Supabase estiver configurado, envia o registro do chunk deduplicado
  if (isSupabaseConfigured()) {
    try {
      const supaSuccess = await uploadAudioChunkDeduplicated({
        id: chunk.id,
        meeting_id: chunk.sessionId,
        session_id: chunk.sessionId,
        sequence_number: chunk.sequence,
        timestamp_start: chunk.timestampStart ?? Math.max(0, (chunk.sequence - 1) * 5.0),
        duration_seconds: chunk.durationSeconds || 5.0,
        blob: chunk.blob,
        status: 'uploaded',
        created_at: new Date(chunk.createdAt).toISOString(),
      });
      if (supaSuccess) {
        serverOk = true;
      }
    } catch {}
  }

  if (serverOk) {
    sentChunkIdsMemory.add(chunk.id);
  }

  return serverOk;
}

async function refreshStatsForSession(sessionId?: string) {
  if (!sessionId) return;
  const stats = await getSessionChunkStats(sessionId);
  notifyUploaderListeners({
    pendingCount: stats.pending,
    syncedCount: stats.synced,
    totalCount: stats.total,
  });
}

async function runUploadLoop(options: UploadQueueOptions): Promise<void> {
  await refreshStatsForSession(options.targetSessionId);

  while ((!options.targetSessionId || !suspendedSessions.has(options.targetSessionId)) &&
    (typeof window === 'undefined' || navigator.onLine)) {
    const chunk = await getOldestChunk(options.targetSessionId);

    if (!chunk) {
      notifyUploaderListeners({ isSyncing: false, lastError: null });
      await refreshStatsForSession(options.targetSessionId);
      break;
    }

    if (suspendedSessions.has(chunk.sessionId)) break;
    notifyUploaderListeners({ isSyncing: true });

    try {
      // 1. Envio ao servidor com prevenção de duplicidade
      let isUploaded = Boolean(chunk.uploaded);
      if (!isUploaded) {
        isUploaded = await syncChunkToServerDeduplicated(chunk);
        if (isUploaded) {
          await updateChunkFlags(chunk.id, { uploaded: true });
        } else if (typeof window !== 'undefined' && !navigator.onLine) {
          throw new Error('Conexão de internet indisponível no momento.');
        }
      }

      if (suspendedSessions.has(chunk.sessionId)) break;

      // 2. Transcrição progressiva (se houver chave de API configurada e ainda não transcrito)
      let isTranscribed = Boolean(chunk.transcribed);
      if (!isTranscribed && hasConfiguredApiKey() && chunk.blob && chunk.blob.size > 300) {
        try {
          const validBlob = await ensureValidWebmBlob(chunk.sessionId, chunk.sequence, chunk.blob, chunk.mimeType);
          const ext = chunk.mimeType.includes('mp4') ? 'mp4' : chunk.mimeType.includes('ogg') ? 'ogg' : 'webm';
          const result = await processAudioTranscription(validBlob, `chunk_${chunk.sequence}.${ext}`);
          if (suspendedSessions.has(chunk.sessionId)) break;
          if (result && result.raw_text && result.raw_text.trim().length > 0) {
            const cb = options.onChunkTranscribed || currentChunkCallback;
            cb?.(result.raw_text.trim(), result.segments || [], chunk.sequence);
          }
          isTranscribed = true;
          await updateChunkFlags(chunk.id, { transcribed: true });
        } catch (transcribeErr: any) {
          if (suspendedSessions.has(chunk.sessionId)) break;
          if (typeof window !== 'undefined' && !navigator.onLine) {
            throw transcribeErr;
          }
          // Se foi erro de conteúdo/silêncio da API mas havia rede, marca transcrito para não travar a fila
          console.warn('[RecorderUploader] Transcrição parcial do chunk falhou:', transcribeErr);
          isTranscribed = true;
          await updateChunkFlags(chunk.id, { transcribed: true });
        }
      } else {
        isTranscribed = true;
      }

      if (isUploaded && isTranscribed) {
        const nowIso = new Date().toISOString();
        await markChunkProcessed(chunk.id, { uploaded: true, transcribed: true });
        const stats = options.targetSessionId
          ? await getSessionChunkStats(options.targetSessionId)
          : { pending: 0, synced: currentUploaderState.syncedCount + 1, total: currentUploaderState.totalCount };
        notifyUploaderListeners({
          pendingCount: stats.pending,
          syncedCount: stats.synced,
          totalCount: stats.total,
          lastSyncedAt: nowIso,
          lastError: null,
        });
        options.onSyncStateChange?.(currentUploaderState);
      } else {
        throw new Error('Falha temporária ao sincronizar segmento com o servidor.');
      }
    } catch (error: any) {
      if (suspendedSessions.has(chunk.sessionId)) break;
      const retries = await incrementChunkRetry(chunk.id, error?.message || 'Erro de sincronização');
      console.warn(`[RecorderUploader] Tentativa #${retries} falhou para ${chunk.id}:`, error?.message || error);
      notifyUploaderListeners({
        isSyncing: false,
        lastError: error?.message || 'Aguardando conexão para sincronizar áudio',
      });
      options.onSyncStateChange?.(currentUploaderState);
      scheduleRetry(options, retries);
      break;
    }
  }

  notifyUploaderListeners({ isSyncing: false });
  options.onSyncStateChange?.(currentUploaderState);
}

export async function processUploadQueue(options: UploadQueueOptions = {}): Promise<void> {
  if (options.targetSessionId && suspendedSessions.has(options.targetSessionId)) return;
  if (options.onChunkTranscribed) {
    currentChunkCallback = options.onChunkTranscribed;
  }

  if (options.targetSessionId) {
    await refreshStatsForSession(options.targetSessionId);
  }

  if (typeof window !== 'undefined' && !navigator.onLine) {
    notifyUploaderListeners({
      isSyncing: false,
      lastError: 'Sem conexão. Segmentos salvos localmente no IndexedDB.',
    });
    return;
  }

  if (activeUploadPromise) {
    await activeUploadPromise;
    if (activeUploadPromise) return activeUploadPromise;
  }
  if (options.targetSessionId && suspendedSessions.has(options.targetSessionId)) return;

  activeUploadPromise = (async () => {
    try {
      await runUploadLoop(options);
    } finally {
      activeUploadPromise = null;
    }
  })();

  await activeUploadPromise;
}

function scheduleRetry(options: UploadQueueOptions, retryCount = 1): void {
  if (retryTimer) return;

  // Exponential backoff: 2s, 4s, 8s, 16s, 32s, até no máximo 60s
  const backoffMs = Math.min(60000, 2000 * Math.pow(2, Math.max(0, retryCount - 1)));

  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processUploadQueue(options);
  }, backoffMs);
}

export function destroyUploader(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export function suspendUploadQueue(sessionId: string) {
  suspendedSessions.add(sessionId);
  destroyUploader();
  notifyUploaderListeners({ isSyncing: false });
}

export function resumeUploadQueue(sessionId: string) {
  suspendedSessions.delete(sessionId);
}

export async function getPendingChunksCount(sessionId?: string): Promise<number> {
  if (sessionId) {
    const stats = await getSessionChunkStats(sessionId);
    return stats.pending;
  }
  return countChunks(sessionId);
}
