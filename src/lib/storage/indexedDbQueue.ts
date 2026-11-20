import { ActiveMeetingSessionState, AudioChunkMetadata, CompleteMeetingDetails, UserAccount } from "@/types/database";

const DB_NAME = "MarcameetRecordingDB";
const DB_VERSION = 3;

const STORE_SESSION = "active_session";
const STORE_CHUNKS = "audio_chunks_queue";
const STORE_COMPLETED_MEETINGS = "completed_meetings_v1";
const STORE_USER_ACCOUNTS = "user_accounts_v1";

let dbInstance: IDBDatabase | null = null;
let persistenceRequested = false;

export async function requestPersistentBrowserStorage(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.storage || !navigator.storage.persist) {
    return false;
  }
  try {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function openDB(): Promise<IDBDatabase> {
  if (!persistenceRequested && typeof window !== "undefined") {
    persistenceRequested = true;
    requestPersistentBrowserStorage().catch(() => {});
  }

  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

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
      if (!db.objectStoreNames.contains(STORE_USER_ACCOUNTS)) {
        const accountStore = db.createObjectStore(STORE_USER_ACCOUNTS, { keyPath: "email" });
        accountStore.createIndex("id", "id", { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onclose = () => { dbInstance = null; };
      dbInstance.onerror = () => { dbInstance = null; };
      resolve(dbInstance);
    };
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

import { saveChunk, deleteChunk, clearSessionChunks } from "@/lib/recording/chunkStore";

/**
 * Salva um bloco de áudio na fila local do IndexedDB (delegado ao chunkStore)
 */
export async function saveChunkToIndexedDB(chunk: AudioChunkMetadata): Promise<void> {
  if (!chunk.blob) return;
  await saveChunk({
    id: chunk.id || `${chunk.meeting_id}_${chunk.session_id}_${chunk.sequence_number}`,
    sessionId: chunk.meeting_id || chunk.session_id,
    sequence: chunk.sequence_number,
    blob: chunk.blob,
    mimeType: chunk.blob.type || "audio/webm",
    createdAt: Date.now(),
    retries: 0,
  });
}

/**
 * Obtém todos os blocos de áudio pendentes na fila local do IndexedDB
 */
export async function getPendingChunksFromIndexedDB(meetingId?: string): Promise<AudioChunkMetadata[]> {
  // Retorna array vazio para forçar o uso da fila sequencial de 1 item por vez via chunkStore e uploader
  return [];
}

/**
 * Remove um bloco de áudio da fila local do IndexedDB
 */
export async function removeChunkFromIndexedDB(chunkId: string): Promise<void> {
  await deleteChunk(chunkId);
}

/**
 * Limpa todos os chunks de uma reunião específica no IndexedDB
 */
export async function clearMeetingChunksInIndexedDB(meetingId: string): Promise<void> {
  await clearSessionChunks(meetingId);
}

/**
 * Salva uma reunião concluída integral no IndexedDB (armazenamento ilimitado para celular)
 */
export async function saveCompletedMeetingToIndexedDB(details: CompleteMeetingDetails): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPLETED_MEETINGS, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("A gravação da transcrição foi interrompida."));
    tx.objectStore(STORE_COMPLETED_MEETINGS).put(details);
  });
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

/**
 * Salva uma conta de usuário no IndexedDB
 */
export async function saveUserAccountToIndexedDB(account: UserAccount): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_USER_ACCOUNTS, "readwrite");
    const store = tx.objectStore(STORE_USER_ACCOUNTS);
    store.put(account);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao salvar conta de usuário no IndexedDB:", err);
  }
}

/**
 * Busca uma conta de usuário pelo email no IndexedDB
 */
export async function getUserAccountFromIndexedDB(email: string): Promise<UserAccount | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_USER_ACCOUNTS, "readonly");
    const store = tx.objectStore(STORE_USER_ACCOUNTS);
    const request = store.get(email.trim().toLowerCase());
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as UserAccount) || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao buscar conta de usuário no IndexedDB:", err);
    return null;
  }
}

/**
 * Lista todas as contas salvas no IndexedDB
 */
export async function getAllUserAccountsFromIndexedDB(): Promise<UserAccount[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_USER_ACCOUNTS, "readonly");
    const store = tx.objectStore(STORE_USER_ACCOUNTS);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as UserAccount[]) || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao listar contas no IndexedDB:", err);
    return [];
  }
}
