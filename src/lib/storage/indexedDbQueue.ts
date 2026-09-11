import { ActiveMeetingSessionState, AudioChunkMetadata } from "@/types/database";

const DB_NAME = "MarcameetRecordingDB";
const DB_VERSION = 1;

const STORE_SESSION = "active_session";
const STORE_CHUNKS = "audio_chunks_queue";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      return reject(new Error("IndexedDB não é suportado neste ambiente."));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SESSION)) {
        db.createObjectStore(STORE_SESSION, { keyPath: "meeting_id" });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: "id" });
        chunkStore.createIndex("meeting_id", "meeting_id", { unique: false });
        chunkStore.createIndex("status", "status", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
  Salva a sessão de reunião ativa no IndexedDB
 */
export async function saveActiveSessionToIndexedDB(session: ActiveMeetingSessionState): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SESSION, "readwrite");
    const store = tx.objectStore(STORE_SESSION);
    store.put(session);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao salvar sessão ativa no IndexedDB:", err);
  }
}

/**
 * Obtém a sessão de reunião ativa armazenada no IndexedDB
 */
export async function getActiveSessionFromIndexedDB(): Promise<ActiveMeetingSessionState | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SESSION, "readonly");
    const store = tx.objectStore(STORE_SESSION);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const results = request.result as ActiveMeetingSessionState[];
        if (!results || results.length === 0) return resolve(null);
        // Retornar a reunião ativa mais recente
        const active = results.find((s) => s.status !== "finished" && s.status !== "idle") || results[0];
        resolve(active || null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao ler sessão ativa do IndexedDB:", err);
    return null;
  }
}

/**
 * Limpa a sessão de reunião ativa do IndexedDB
 */
export async function clearActiveSessionInIndexedDB(meetingId?: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SESSION, "readwrite");
    const store = tx.objectStore(STORE_SESSION);
    if (meetingId) {
      store.delete(meetingId);
    } else {
      store.clear();
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao limpar sessão ativa do IndexedDB:", err);
  }
}

/**
 * Salva um bloco de áudio na fila local do IndexedDB
 */
export async function saveChunkToIndexedDB(chunk: AudioChunkMetadata): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CHUNKS, "readwrite");
    const store = tx.objectStore(STORE_CHUNKS);
    store.put(chunk);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao salvar chunk no IndexedDB:", err);
  }
}

/**
 * Obtém todos os blocos de áudio pendentes na fila local do IndexedDB
 */
export async function getPendingChunksFromIndexedDB(meetingId?: string): Promise<AudioChunkMetadata[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CHUNKS, "readonly");
    const store = tx.objectStore(STORE_CHUNKS);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        let results = (request.result as AudioChunkMetadata[]) || [];
        if (meetingId) {
          results = results.filter((c) => c.meeting_id === meetingId);
        }
        // Ordenar por número de sequência crescente
        results.sort((a, b) => a.sequence_number - b.sequence_number);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao obter chunks pendentes do IndexedDB:", err);
    return [];
  }
}

/**
 * Remove um bloco de áudio da fila local do IndexedDB após confirmação de upload pelo backend
 */
export async function removeChunkFromIndexedDB(chunkId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CHUNKS, "readwrite");
    const store = tx.objectStore(STORE_CHUNKS);
    store.delete(chunkId);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao remover chunk do IndexedDB:", err);
  }
}

/**
 * Limpa todos os chunks de uma reunião específica no IndexedDB
 */
export async function clearMeetingChunksInIndexedDB(meetingId: string): Promise<void> {
  try {
    const pending = await getPendingChunksFromIndexedDB(meetingId);
    for (const chunk of pending) {
      await removeChunkFromIndexedDB(chunk.id);
    }
  } catch (err) {
    console.warn("Falha ao limpar chunks da reunião do IndexedDB:", err);
  }
}
