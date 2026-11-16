import { getOldestChunk, deleteChunk, countChunks } from './chunkStore';
import { uploadAudioChunkDeduplicated, isSupabaseConfigured } from '@/lib/supabase/client';
import { processAudioTranscription, hasConfiguredApiKey } from '@/lib/ai';

let activeUploadPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let currentChunkCallback: ((text: string, segments: any[]) => void) | undefined = undefined;

// Cache leve (~200 bytes) do cabeçalho EBML/WebM inicial da sessão para que os chunks 2..N sejam arquivos WebM válidos para o Whisper
const webmHeaderCache = new Map<string, Uint8Array>();

export interface UploadQueueOptions {
  targetSessionId?: string;
  onChunkTranscribed?: (text: string, segments: any[]) => void;
}

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

async function runUploadLoop(options: UploadQueueOptions): Promise<void> {
  while (typeof window === 'undefined' || navigator.onLine) {
    const chunk = await getOldestChunk(options.targetSessionId);

    if (!chunk) break;

    try {
      let isUploadedOrTranscribed = false;

      // 1. Se o Supabase estiver configurado, envia o registro do chunk deduplicado
      if (isSupabaseConfigured()) {
        const success = await uploadAudioChunkDeduplicated({
          id: chunk.id,
          meeting_id: chunk.sessionId,
          session_id: chunk.sessionId,
          sequence_number: chunk.sequence,
          timestamp_start: Math.max(0, (chunk.sequence - 1) * 5.0),
          duration_seconds: 5.0,
          blob: chunk.blob,
          status: 'pending_local',
          created_at: new Date(chunk.createdAt).toISOString(),
        });
        if (success) {
          isUploadedOrTranscribed = true;
        }
      }

      // 2. Se houver chave de API de IA configurada, transcreve o bloco de áudio e envia ao callback
      if (hasConfiguredApiKey() && chunk.blob && chunk.blob.size > 300) {
        try {
          const validBlob = await ensureValidWebmBlob(chunk.sessionId, chunk.sequence, chunk.blob, chunk.mimeType);
          const ext = chunk.mimeType.includes('mp4') ? 'mp4' : chunk.mimeType.includes('ogg') ? 'ogg' : 'webm';
          const result = await processAudioTranscription(validBlob, `chunk_${chunk.sequence}.${ext}`);
          if (result && result.raw_text && result.raw_text.trim().length > 0) {
            const cb = options.onChunkTranscribed || currentChunkCallback;
            cb?.(result.raw_text.trim(), result.segments || []);
          }
          isUploadedOrTranscribed = true;
        } catch (e) {
          console.warn('[RecorderUploader] Transcrição parcial do chunk falhou:', e);
          isUploadedOrTranscribed = true;
        }
      } else {
        isUploadedOrTranscribed = true;
      }

      if (isUploadedOrTranscribed) {
        await deleteChunk(chunk.id);
      } else {
        throw new Error('Falha no processamento do chunk');
      }
    } catch (error) {
      console.error('[RecorderUploader] Erro no upload/processamento do chunk:', error);
      scheduleRetry(options);
      break;
    }
  }
}

export async function processUploadQueue(options: UploadQueueOptions = {}): Promise<void> {
  if (options.onChunkTranscribed) {
    currentChunkCallback = options.onChunkTranscribed;
  }

  if (typeof window !== 'undefined' && !navigator.onLine) return;

  if (activeUploadPromise) {
    await activeUploadPromise;
  }

  activeUploadPromise = (async () => {
    try {
      await runUploadLoop(options);
    } finally {
      activeUploadPromise = null;
    }
  })();

  await activeUploadPromise;
}

function scheduleRetry(options: UploadQueueOptions): void {
  if (retryTimer) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processUploadQueue(options);
  }, 5000);
}

export function destroyUploader(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export async function getPendingChunksCount(sessionId?: string): Promise<number> {
  return countChunks(sessionId);
}
