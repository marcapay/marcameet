export interface RecordingChunk {
  id: string;
  sessionId: string;
  sequence: number;
  blob: Blob;
  mimeType: string;
  createdAt: number;
  retries: number;
}

const DB_NAME = 'meeting-recorder-v2';
const DB_VERSION = 1;
const STORE_NAME = 'recording-chunks';

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
    };

    request.onsuccess = () => resolve(request.result);

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
 * Remove um bloco de áudio do IndexedDB após confirmação do envio/transcrição
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
 * Obtém APENAS O UNICO CHUNK MAIS ANTIGO através de Cursor Nativo do IndexedDB.
 * Garante que nunca múltiplos Blobs serão carregados simultaneamente para a RAM.
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
      if (targetSessionId && chunk.sessionId !== targetSessionId) {
        cursor.continue();
        return;
      }

      resolve(chunk);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Retorna o número total de chunks pendentes na fila local do IndexedDB
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
 * Exclui todos os chunks salvos de uma reunião específica
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
