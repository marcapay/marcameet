import { getOldestChunk, deleteChunk, countChunks } from './chunkStore';
import { uploadAudioChunkDeduplicated, isSupabaseConfigured } from '@/lib/supabase/client';
import { processAudioTranscription, hasConfiguredApiKey } from '@/lib/ai';

let uploading = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export interface UploadQueueOptions {
  targetSessionId?: string;
  onChunkTranscribed?: (text: string, segments: any[]) => void;
}

export async function processUploadQueue(options: UploadQueueOptions = {}): Promise<void> {
  if (uploading) return;
  if (typeof window !== 'undefined' && !navigator.onLine) return;

  uploading = true;

  try {
    while (typeof window === 'undefined' || navigator.onLine) {
      const chunk = await getOldestChunk(options.targetSessionId);

      if (!chunk) break;

      try {
        let isUploadedOrTranscribed = false;

        // 1. Se o Supabase estiver configurado, envia a confirmação deduplicada
        if (isSupabaseConfigured()) {
          const success = await uploadAudioChunkDeduplicated({
            id: chunk.id,
            meeting_id: chunk.sessionId,
            session_id: chunk.sessionId,
            sequence_number: chunk.sequence,
            timestamp_start: chunk.sequence * 5.0,
            duration_seconds: 5.0,
            blob: chunk.blob,
            status: 'pending_local',
            created_at: new Date(chunk.createdAt).toISOString(),
          });
          if (success) {
            isUploadedOrTranscribed = true;
          }
        }

        // 2. Se houver chave de API de IA configurada, transcreve o segmento de 5 segundos progressivamente
        if (hasConfiguredApiKey()) {
          try {
            const result = await processAudioTranscription(chunk.blob, `chunk_${chunk.sequence}.webm`);
            if (result && result.raw_text && result.raw_text.trim().length > 0) {
              options.onChunkTranscribed?.(result.raw_text, result.segments || []);
            }
            isUploadedOrTranscribed = true;
          } catch (e) {
            console.warn('[RecorderUploader] Transcrição parcial do chunk falhou:', e);
          }
        } else {
          // Se não houver backend ou API Key configurada, considera processado localmente
          isUploadedOrTranscribed = true;
        }

        if (isUploadedOrTranscribed) {
          // Excluir chunk do IndexedDB -> Liberação imediata da memória do Blob
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
  } finally {
    uploading = false;
  }
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
  uploading = false;
}

export async function getPendingChunksCount(sessionId?: string): Promise<number> {
  return countChunks(sessionId);
}
