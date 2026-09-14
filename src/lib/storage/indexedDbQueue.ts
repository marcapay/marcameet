import { ActiveMeetingSessionState, AudioChunkMetadata, CompleteMeetingDetails } from "@/types/database";

const DB_NAME = "MarcameetRecordingDB";
const DB_VERSION = 2;

const STORE_SESSION = "active_session";
const STORE_CHUNKS = "audio_chunks_queue";
const STORE_COMPLETED_MEETINGS = "completed_meetings_v1";

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
      if (!db.objectStoreNames.contains(STORE_COMPLETED_MEETINGS)) {
        db.createObjectStore(STORE_COMPLETED_MEETINGS, { keyPath: "meeting.id" });
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

/**
 * Salva uma reunião concluída integral no IndexedDB (armazenamento ilimitado para celular)
 */
export async function saveCompletedMeetingToIndexedDB(details: CompleteMeetingDetails): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_COMPLETED_MEETINGS, "readwrite");
    const store = tx.objectStore(STORE_COMPLETED_MEETINGS);
    store.put(details);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao salvar reunião concluída no IndexedDB:", err);
  }
}

/**
 * Obtém todas as reuniões concluídas armazenadas no IndexedDB
 */
export async function getCompletedMeetingsFromIndexedDB(): Promise<CompleteMeetingDetails[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_COMPLETED_MEETINGS, "readonly");
    const store = tx.objectStore(STORE_COMPLETED_MEETINGS);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao carregar reuniões do IndexedDB:", err);
    return [];
  }
}

/**
 * Exclui uma reunião concluída do IndexedDB
 */
export async function deleteCompletedMeetingFromIndexedDB(meetingId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_COMPLETED_MEETINGS, "readwrite");
    const store = tx.objectStore(STORE_COMPLETED_MEETINGS);
    store.delete(meetingId);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao excluir reunião do IndexedDB:", err);
  }
}
