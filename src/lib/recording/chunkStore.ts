import { saveAudioBlobToSupabase } from '@/lib/supabase/client';

export interface RecordingChunk {
  id: string;
  sessionId: string;
  sequence: number;
  blob: Blob;
  mimeType: string;
  createdAt: number;
  retries: number;
  processed?: boolean;
}

export interface StoredMeetingAudio {
  meetingId: string;
  blob: Blob;
  mimeType: string;
  updatedAt: number;
}

const DB_NAME = 'meeting-recorder-v2';
const DB_VERSION = 2;
const STORE_NAME = 'recording-chunks';
const STORE_FULL_AUDIO = 'meeting-full-audio';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      return reject(new Error('IndexedDB não é suportado neste ambiente.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
        });

        store.createIndex('sessionId', 'sessionId', {
          unique: false,
        });

        store.createIndex('createdAt', 'createdAt', {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(STORE_FULL_AUDIO)) {
        db.createObjectStore(STORE_FULL_AUDIO, {
          keyPath: 'meetingId',
        });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * Salva um bloco de áudio no IndexedDB em disco
 */
export async function saveChunk(chunk: RecordingChunk): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.put(chunk);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Marca um bloco de áudio como processado na fila sem apagar o Blob (para permitir montar o áudio completo no final)
 */
export async function markChunkProcessed(id: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const data = getReq.result as RecordingChunk | undefined;
      if (data) {
        data.processed = true;
        store.put(data);
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Remove um bloco de áudio do IndexedDB
 */
export async function deleteChunk(id: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.delete(id);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Obtém o chunk não processado mais antigo através de Cursor do IndexedDB
 */
export async function getOldestChunk(targetSessionId?: string): Promise<RecordingChunk | null> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('createdAt');

    const request = index.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        resolve(null);
        return;
      }

      const chunk = cursor.value as RecordingChunk;
      if (chunk.processed || (targetSessionId && chunk.sessionId !== targetSessionId)) {
        cursor.continue();
        return;
      }

      resolve(chunk);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Obtém todos os chunks de uma sessão ordenados por sequence para montar o arquivo de áudio completo da reunião
 */
export async function getAllSessionChunksOrdered(sessionId: string): Promise<RecordingChunk[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');
    const request = index.getAll(IDBKeyRange.only(sessionId));

    request.onsuccess = () => {
      const list = (request.result as RecordingChunk[]) || [];
      list.sort((a, b) => a.sequence - b.sequence);
      resolve(list);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Salva o arquivo de áudio completo consolidado da reunião no IndexedDB para reprodução no MediaPlayer
 */
export async function saveMeetingAudioBlob(meetingId: string, blob: Blob, mimeType?: string): Promise<void> {
  if (!meetingId || !blob || blob.size === 0) return;
  saveAudioBlobToSupabase(meetingId, blob).catch(() => {});
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_FULL_AUDIO, 'readwrite');
      const store = transaction.objectStore(STORE_FULL_AUDIO);
      const record: StoredMeetingAudio = {
        meetingId,
        blob,
        mimeType: mimeType || blob.type || 'audio/webm',
        updatedAt: Date.now(),
      };
      store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.warn('Aviso ao salvar áudio completo da reunião:', err);
  }
}

/**
 * Recupera o arquivo de áudio completo da reunião do IndexedDB para tocar no MediaPlayer
 */
export async function getMeetingAudioBlob(meetingId: string): Promise<Blob | null> {
  if (!meetingId) return null;
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_FULL_AUDIO, 'readonly');
      const store = transaction.objectStore(STORE_FULL_AUDIO);
      const request = store.get(meetingId);

      request.onsuccess = async () => {
        const res = request.result as StoredMeetingAudio | undefined;
        if (res && res.blob && res.blob.size > 0) {
          resolve(res.blob);
          return;
        }
        // Fallback: se a reunião ainda tiver chunks na fila, monta o Blob a partir deles
        try {
          const chunks = await getAllSessionChunksOrdered(meetingId);
          if (chunks.length > 0) {
            const combined = new Blob(
              chunks.map((c) => c.blob),
              { type: chunks[0].mimeType || 'audio/webm' }
            );
            resolve(combined);
            return;
          }
        } catch {}
        resolve(null);
      };

      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * Exclui o áudio completo salvo de uma reunião quando ela é deletada
 */
export async function deleteMeetingAudioBlob(meetingId: string): Promise<void> {
  if (!meetingId) return;
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_FULL_AUDIO, 'readwrite');
      const store = transaction.objectStore(STORE_FULL_AUDIO);
      store.delete(meetingId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {}
}

/**
 * Retorna o número total de chunks na fila local do IndexedDB
 */
export async function countChunks(targetSessionId?: string): Promise<number> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    if (targetSessionId) {
      const index = store.index('sessionId');
      const request = index.count(IDBKeyRange.only(targetSessionId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
  });
}

/**
 * Exclui todos os chunks temporários de uma sessão após o áudio completo ter sido consolidado
 */
export async function clearSessionChunks(sessionId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');

    const request = index.openCursor(IDBKeyRange.only(sessionId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };

    request.onerror = () => reject(request.error);
  });
}
