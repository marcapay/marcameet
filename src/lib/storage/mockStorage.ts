import { CompleteMeetingDetails, UserAccount } from "@/types/database";
import {
  deleteMeetingFromSupabase,
  saveMeetingToSupabase,
  fetchMeetingsFromSupabase,
  saveUserAccountToSupabase,
  isSupabaseConfigured,
  ensureValidUuid,
} from "@/lib/supabase/client";
import {
  saveCompletedMeetingToIndexedDB,
  getCompletedMeetingsFromIndexedDB,
  deleteCompletedMeetingFromIndexedDB,
  clearActiveSessionInIndexedDB,
  requestPersistentBrowserStorage,
} from "@/lib/storage/indexedDbQueue";
import { getCurrentAccount, subscribeAccountChange } from "@/lib/auth/accountSystem";
import { clearSessionChunks, deleteMeetingAudioBlob } from "@/lib/recording/chunkStore";
import { getStoredKey, setStoredKey } from "@/lib/storage/keysStorage";

const STORAGE_KEY_MEETINGS = "marcameet_meetings_v2";
const DELETION_PREFIX = "marcameet_deleted_meeting_";
const deletionRecords = new Map<string, { id: string; pending: boolean; requiresSupabase?: boolean }>();
const pendingDeletes = new Map<string, Promise<boolean>>();

function rememberDeletion(id: string, pending: boolean, requiresSupabase = false) {
  const canonical = ensureValidUuid(id);
  const entry = { id, pending, requiresSupabase };
  deletionRecords.set(canonical, entry);
  try { localStorage.setItem(DELETION_PREFIX + canonical, JSON.stringify(entry)); } catch {}
}

export function isDeletedMeeting(id: string) {
  const key = ensureValidUuid(id);
  if (deletionRecords.has(key)) return true;
  try { return localStorage.getItem(DELETION_PREFIX + key) !== null; } catch { return false; }
}

function discardCachedMeeting(id: string) {
  const canonical = ensureValidUuid(id);
  const identities = new Set([id, canonical]);
  for (const [key, meeting] of allMeetingsMap) {
    if (ensureValidUuid(key) === canonical) {
      identities.add(key);
      identities.add(meeting.meeting.id);
      allMeetingsMap.delete(key);
    }
  }
  return identities;
}

async function removeMeetingFiles(ids: Iterable<string>) {
  await Promise.all(Array.from(ids, async (id) => {
    await Promise.all([
      deleteCompletedMeetingFromIndexedDB(id),
      clearActiveSessionInIndexedDB(id),
      deleteMeetingAudioBlob(id),
      clearSessionChunks(id),
    ]);
  }));
}

async function syncMeetingDeletion(id: string): Promise<boolean> {
  const canonical = ensureValidUuid(id);
  const ongoing = pendingDeletes.get(canonical);
  if (ongoing) return ongoing;
  const request = (async () => {
    try {
      const configured = isSupabaseConfigured();
      const server = fetch("/api/cloud-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletedMeetingId: id }),
        signal: AbortSignal.timeout(10000),
      });
      const [res, cloudDeleted] = await Promise.all([
        server.catch(() => null),
        configured ? deleteMeetingFromSupabase(id) : Promise.resolve(true),
      ]);
      if (!res?.ok || !cloudDeleted) return false;
      rememberDeletion(id, !configured, !configured);
      return true;
    } catch {
      return false;
    } finally {
      pendingDeletes.delete(canonical);
    }
  })();
  pendingDeletes.set(canonical, request);
  return request;
}

async function retryMeetingDeletions() {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(DELETION_PREFIX)) continue;
      const entry = JSON.parse(localStorage.getItem(key) || "null");
      if (typeof entry?.id === "string") deletionRecords.set(ensureValidUuid(entry.id), entry);
    }
  } catch {}
  await Promise.all(Array.from(deletionRecords.values())
    .filter(({ pending, requiresSupabase }) => pending && (!requiresSupabase || isSupabaseConfigured()))
    .map(({ id }) => syncMeetingDeletion(id)));
}

function receiveMeetingDeletions(ids: unknown) {
  if (!Array.isArray(ids)) return;
  for (const id of ids) {
    if (typeof id !== "string" || isDeletedMeeting(id)) continue;
    rememberDeletion(id, false);
    discardCachedMeeting(id);
  }
}
const getAccountStorageKey = (accountId: string) => `marcameet_meetings_acc_${accountId}`;

export const INITIAL_MOCK_MEETINGS: CompleteMeetingDetails[] = [];

// Cache em memória de todas as reuniões conhecidas no dispositivo
let allMeetingsMap = new Map<string, CompleteMeetingDetails>();
let isLocalStorageLoaded = false;
let hasSyncedIndexedDB = false;
let lastSyncedAccountId: string | null = null;
const listeners = new Set<(meetings: CompleteMeetingDetails[]) => void>();

export function subscribeLocalMeetings(callback: (meetings: CompleteMeetingDetails[]) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function isLegacyMockMeeting(m: CompleteMeetingDetails): boolean {
  if (!m?.meeting?.id) return true;
  if (m.meeting.id === "m-101") return true;
  if (m.meeting.title?.includes("Alinhamento Estratégico Q3")) return true;
  if (m.meeting.title?.includes("Exemplo")) return true;
  if (m.meeting.source_type === ("account_profile" as any)) return true;
  if (Array.isArray(m.meeting.tags) && m.meeting.tags.includes("__account_profile__")) return true;
  return false;
}

function isAnonymousUserId(userId?: string): boolean {
  return !userId || userId === "u-001" || userId === "anonymous" || userId === "guest";
}

function mergeMeetingEntries(a: CompleteMeetingDetails, b: CompleteMeetingDetails): CompleteMeetingDetails {
  const aHasSummary = Boolean(a.summary?.objective);
  const bHasSummary = Boolean(b.summary?.objective);
  if (bHasSummary && !aHasSummary) return b;
  if (aHasSummary && !bHasSummary) return a;

  const aTime = new Date(a.meeting.updated_at || a.meeting.meeting_date || 0).getTime();
  const bTime = new Date(b.meeting.updated_at || b.meeting.meeting_date || 0).getTime();
  return bTime >= aTime ? b : a;
}

function meetingItems<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value.filter((item) => item != null) : [];
}

function normalizeMeetingDetails(item: CompleteMeetingDetails): CompleteMeetingDetails {
  return {
    ...item,
    meeting: { ...item.meeting, tags: meetingItems(item.meeting.tags) },
    summary: item.summary
      ? { ...item.summary, key_topics: meetingItems(item.summary.key_topics).filter((topic) => typeof topic === "string") }
      : undefined,
    transcript: item.transcript ? {
      ...item.transcript,
      speaker_map: Object.fromEntries(Object.entries(item.transcript.speaker_map || {})
        .filter(([, name]) => typeof name === "string")),
      segments: meetingItems(item.transcript.segments)
        .filter((segment) => typeof segment.text === "string")
        .map((segment) => ({
          ...segment,
          speaker: typeof segment.speaker === "string" ? segment.speaker : "Falante não identificado",
        })),
    } : undefined,
    decisions: meetingItems(item.decisions),
    highlights: meetingItems(item.highlights),
    tasks: meetingItems(item.tasks),
    pending_items: meetingItems(item.pending_items),
    risks: meetingItems(item.risks),
    opportunities: meetingItems(item.opportunities),
    values: meetingItems(item.values),
    dates: meetingItems(item.dates),
    quotes: meetingItems(item.quotes),
    next_steps_agreed: meetingItems(item.next_steps_agreed),
    next_steps_ai_suggestions: meetingItems(item.next_steps_ai_suggestions),
  };
}

function upsertIntoMeetingsMap(input: CompleteMeetingDetails) {
  if (!input?.meeting?.id || isLegacyMockMeeting(input) || isDeletedMeeting(input.meeting.id)) return;
  const item = normalizeMeetingDetails(input);
  const canonicalUuid = ensureValidUuid(item.meeting.id);

  // Verificar se já existe com o mesmo ID ou mesmo UUID canônico
  let existingKey: string | null = null;
  if (allMeetingsMap.has(item.meeting.id)) {
    existingKey = item.meeting.id;
  } else if (allMeetingsMap.has(canonicalUuid)) {
    existingKey = canonicalUuid;
  } else {
    allMeetingsMap.forEach((_, k) => {
      if (ensureValidUuid(k) === canonicalUuid) {
        existingKey = k;
      }
    });
  }

  if (existingKey) {
    const existing = allMeetingsMap.get(existingKey)!;
    const merged = mergeMeetingEntries(existing, item);
    allMeetingsMap.set(existingKey, merged);
  } else {
    allMeetingsMap.set(item.meeting.id, item);
  }
}

function filterMeetingsForCurrentUser(allList: CompleteMeetingDetails[], account: UserAccount | null): CompleteMeetingDetails[] {
  const valid = allList.filter((m) => !isLegacyMockMeeting(m) && !isDeletedMeeting(m.meeting.id));

  // Deduplicar por UUID canônico
  const dedupedMap = new Map<string, CompleteMeetingDetails>();
  for (const m of valid) {
    const uuid = ensureValidUuid(m.meeting.id);
    const existing = dedupedMap.get(uuid);
    if (existing) {
      dedupedMap.set(uuid, mergeMeetingEntries(existing, m));
    } else {
      dedupedMap.set(uuid, m);
    }
  }

  const dedupedList = Array.from(dedupedMap.values());

  if (!account) {
    return dedupedList.sort(
      (a, b) => new Date(b.meeting.meeting_date).getTime() - new Date(a.meeting.meeting_date).getTime()
    );
  }

  const cleanEmail = account.email.trim().toLowerCase();
  const accountUuid = ensureValidUuid(account.id, `marcameet_user:${cleanEmail}`);

  return dedupedList
    .filter((m) => {
      const mUserId = m.meeting.user_id;
      const mEmail = m.meeting.user_email?.trim().toLowerCase();
      // Se não tiver e-mail de outra conta diferente, pertence à conta ativa no projeto
      if (!mEmail || mEmail === cleanEmail) return true;
      if (mUserId === account.id || ensureValidUuid(mUserId) === accountUuid) return true;
      return isAnonymousUserId(mUserId);
    })
    .sort((a, b) => new Date(b.meeting.meeting_date).getTime() - new Date(a.meeting.meeting_date).getTime());
}

function notifyListeners() {
  const account = getCurrentAccount();
  const list = filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), account);
  listeners.forEach((fn) => {
    try {
      fn(list);
    } catch (e) {}
  });
}

function persistMeetingsToLocalStorage(account: UserAccount | null) {
  if (typeof window === "undefined") return;
  const allList = filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), null);

  try {
    localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(allList));
  } catch (e) {
    try {
      localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(allList.slice(0, 15)));
    } catch {}
  }

  if (account) {
    const accountList = filterMeetingsForCurrentUser(allList, account);
    try {
      localStorage.setItem(getAccountStorageKey(account.id), JSON.stringify(accountList));
    } catch {
      try {
        localStorage.setItem(getAccountStorageKey(account.id), JSON.stringify(accountList.slice(0, 15)));
      } catch {}
    }
  }
}

/**
 * Adota reuniões locais sem e-mail ou com user_id antigo para a conta logada e sincroniza com IndexedDB e Nuvem
 */
function adoptAnonymousMeetingsForAccount(account: UserAccount): boolean {
  let adoptedAny = false;
  const cleanEmail = account.email.trim().toLowerCase();

  allMeetingsMap.forEach((item, id) => {
    const itemEmail = item.meeting.user_email?.trim().toLowerCase();
    if (!itemEmail || itemEmail === cleanEmail || isAnonymousUserId(item.meeting.user_id)) {
      if (item.meeting.user_id !== account.id || itemEmail !== cleanEmail) {
        const updated: CompleteMeetingDetails = {
          ...item,
          meeting: {
            ...item.meeting,
            user_id: account.id,
            user_email: cleanEmail,
          },
        };
        allMeetingsMap.set(id, updated);
        saveCompletedMeetingToIndexedDB(updated).catch(() => {});
        saveMeetingToSupabase(updated).catch(() => {});
        adoptedAny = true;
      }
    }
  });
  return adoptedAny;
}

/**
 * Sincroniza reuniões da conta via /api/cloud-sync, IndexedDB e Supabase Cloud
 */
export async function syncAccountMeetingsNow(): Promise<{ totalSaved: number; syncedCloud: boolean }> {
  if (typeof window === "undefined") return { totalSaved: 0, syncedCloud: false };

  await requestPersistentBrowserStorage().catch(() => {});
  const account = getCurrentAccount();

  // 1. Ler do IndexedDB
  try {
    const idbMeetings = await getCompletedMeetingsFromIndexedDB();
    idbMeetings.forEach((item) => {
      upsertIntoMeetingsMap(item);
    });
  } catch {}

  // 2. Ler do cache específico da conta no localStorage
  if (account) {
    try {
      const rawAcc = localStorage.getItem(getAccountStorageKey(account.id));
      if (rawAcc) {
        const parsedAcc = JSON.parse(rawAcc) as CompleteMeetingDetails[];
        parsedAcc.forEach((item) => {
          upsertIntoMeetingsMap(item);
        });
      }
    } catch {}

    adoptAnonymousMeetingsForAccount(account);
  }

  let syncedCloud = false;
  await retryMeetingDeletions();

  // 3. Sincronizar via /api/cloud-sync (compartilha chaves e reuniões instantaneamente entre celular e computador)
  try {
    const localListForSync = filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), account);
    const res = await fetch("/api/cloud-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supa_url: getStoredKey("supa_url", "https://xuooojiaslhwaejsgjxh.supabase.co") || undefined,
        supa_anon_key: getStoredKey("supa_anon_key") || undefined,
        ai_openai_key: getStoredKey("ai_openai_key") || undefined,
        ai_gemini_key: getStoredKey("ai_gemini_key") || undefined,
        ai_groq_key: getStoredKey("ai_groq_key") || undefined,
        account: account || undefined,
        meetings: localListForSync,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.supa_url && !getStoredKey("supa_url")) setStoredKey("supa_url", data.supa_url);
      if (data.supa_anon_key && !getStoredKey("supa_anon_key")) setStoredKey("supa_anon_key", data.supa_anon_key);
      if (data.ai_openai_key && !getStoredKey("ai_openai_key")) setStoredKey("ai_openai_key", data.ai_openai_key);
      if (data.ai_gemini_key && !getStoredKey("ai_gemini_key")) setStoredKey("ai_gemini_key", data.ai_gemini_key);
      if (data.ai_groq_key && !getStoredKey("ai_groq_key")) setStoredKey("ai_groq_key", data.ai_groq_key);

      receiveMeetingDeletions(data.deletedMeetingIds);
      if (isSupabaseConfigured()) await retryMeetingDeletions();
      if (Array.isArray(data.meetings)) {
        for (const m of data.meetings) {
          upsertIntoMeetingsMap(m);
        }
      }
      syncedCloud = true;
    }
  } catch {}

  // 4. Sincronizar com Supabase se configurado
  if (isSupabaseConfigured()) {
    try {
      if (account) {
        await saveUserAccountToSupabase(account).catch(() => {});
      }

      // Primeiro enviar reuniões locais para o Supabase (com __MM_JSON__ completo)
      const localBeforePull = filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), account);
      await Promise.all(
        localBeforePull.slice(0, 30).map((m) =>
          saveMeetingToSupabase(m).catch(() => false)
        )
      );

      // Depois buscar todas as reuniões do Supabase
      const cloudMeetings = await fetchMeetingsFromSupabase(account?.id, account?.email);
      cloudMeetings.forEach((cloudItem) => {
        upsertIntoMeetingsMap(cloudItem);
      });

      syncedCloud = true;
    } catch {}
  }

  if (account) {
    adoptAnonymousMeetingsForAccount(account);
  }

  // 5. Garantir que todas as reuniões consolidadas estejam salvas no IndexedDB e localStorage
  const finalAccountList = filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), account);
  finalAccountList.forEach((m) => {
    saveCompletedMeetingToIndexedDB(m).catch(() => {});
  });
  persistMeetingsToLocalStorage(account);
  notifyListeners();

  return {
    totalSaved: finalAccountList.length,
    syncedCloud,
  };
}

// Ouvir mudanças de conta e eventos de foco/visibilidade para manter celular e computador sempre sincronizados
if (typeof window !== "undefined") {
  subscribeAccountChange((account) => {
    if (account) {
      adoptAnonymousMeetingsForAccount(account);
      persistMeetingsToLocalStorage(account);
    }
    notifyListeners();
    syncAccountMeetingsNow().catch(() => {});
  });

  window.addEventListener("online", () => {
    syncAccountMeetingsNow().catch(() => {});
  });

  window.addEventListener("focus", () => {
    syncAccountMeetingsNow().catch(() => {});
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncAccountMeetingsNow().catch(() => {});
    }
  });

  setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      syncAccountMeetingsNow().catch(() => {});
    }
  }, 15000);
}

export function getLocalMeetings(): CompleteMeetingDetails[] {
  if (typeof window === "undefined") return [];

  const account = getCurrentAccount();

  if (!isLocalStorageLoaded) {
    isLocalStorageLoaded = true;
    try {
      const data = localStorage.getItem(STORAGE_KEY_MEETINGS);
      if (data) {
        const listFromStorage = JSON.parse(data) as CompleteMeetingDetails[];
        listFromStorage.forEach((m) => {
          upsertIntoMeetingsMap(m);
        });
      }
    } catch (e) {
      console.error("Erro ao carregar reuniões do localStorage:", e);
    }
  }

  if (account) {
    try {
      const accData = localStorage.getItem(getAccountStorageKey(account.id));
      if (accData) {
        const accList = JSON.parse(accData) as CompleteMeetingDetails[];
        accList.forEach((m) => {
          upsertIntoMeetingsMap(m);
        });
      }
    } catch {}

    if (adoptAnonymousMeetingsForAccount(account)) {
      persistMeetingsToLocalStorage(account);
    }
  }

  // Sincronizar assincronamente com IndexedDB, /api/cloud-sync e Supabase na inicialização ou ao trocar de conta
  if (!hasSyncedIndexedDB || (account && lastSyncedAccountId !== account.id)) {
    hasSyncedIndexedDB = true;
    lastSyncedAccountId = account?.id || null;
    syncAccountMeetingsNow().catch(() => {});
  }

  return filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), account);
}

export function saveLocalMeeting(details: CompleteMeetingDetails, discardRecordedAudio = false): void {
  if (typeof window === "undefined" || !details?.meeting?.id || isDeletedMeeting(details.meeting.id)) return;

  const account = getCurrentAccount();

  const enrichedDetails: CompleteMeetingDetails = {
    ...details,
    meeting: {
      ...details.meeting,
      user_id: account ? account.id : details.meeting.user_id || "u-001",
      user_email: account ? account.email.trim().toLowerCase() : details.meeting.user_email,
      updated_at: new Date().toISOString(),
    },
    tasks: (details.tasks || []).map((t) => ({
      ...t,
      user_id: account ? account.id : t.user_id || "u-001",
    })),
  };

  // 1. Atualizar cache em memória
  upsertIntoMeetingsMap(enrichedDetails);
  notifyListeners();

  // 2. Salvar no localStorage (geral e da conta)
  persistMeetingsToLocalStorage(account);

  // 3. Salvar no IndexedDB
  void saveCompletedMeetingToIndexedDB(enrichedDetails)
    .then(async () => {
      if (discardRecordedAudio && enrichedDetails.transcript?.raw_text.trim()) {
        await clearSessionChunks(enrichedDetails.meeting.id);
      }
    })
    .catch((err) => console.warn("Falha ao salvar a reunião ou limpar o áudio temporário:", err));

  // 4. Sincronizar criação/atualização no Supabase e no /api/cloud-sync
  saveMeetingToSupabase(enrichedDetails).catch((err) =>
    console.warn("Falha na sincronização assíncrona com Supabase:", err)
  );

  fetch("/api/cloud-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meetings: [enrichedDetails],
    }),
  }).catch(() => {});
}

export async function deleteLocalMeeting(meetingId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  rememberDeletion(meetingId, true);
  const ids = discardCachedMeeting(meetingId);
  persistMeetingsToLocalStorage(getCurrentAccount());
  notifyListeners();

  const [local, remote] = await Promise.allSettled([
    removeMeetingFiles(ids),
    syncMeetingDeletion(meetingId),
  ]);
  return local.status === "fulfilled" && remote.status === "fulfilled" && remote.value;
}

export function updateSpeakerNameInMeeting(meetingId: string, oldSpeaker: string, newSpeaker: string): CompleteMeetingDetails | null {
  const current = getLocalMeetings();
  const target = current.find((m) => m.meeting.id === meetingId);
  if (!target || !target.transcript) return null;

  target.transcript.speaker_map[oldSpeaker] = newSpeaker;

  if (target.transcript.segments) {
    target.transcript.segments = target.transcript.segments.map((seg) => {
      if (seg.speaker === oldSpeaker) {
        return { ...seg, speaker: newSpeaker };
      }
      return seg;
    });
  }

  target.quotes = target.quotes.map((q) => {
    if (q.speaker === oldSpeaker) {
      return { ...q, speaker: newSpeaker };
    }
    return q;
  });

  saveLocalMeeting(target);
  return target;
}

export function updateMeetingTitle(meetingId: string, newTitle: string): CompleteMeetingDetails | null {
  const current = getLocalMeetings();
  const target = current.find((m) => m.meeting.id === meetingId);
  if (!target) return null;

  target.meeting.title = newTitle;
  target.meeting.updated_at = new Date().toISOString();

  if (target.tasks) {
    target.tasks = target.tasks.map((t) => ({ ...t, meeting_title: newTitle }));
  }

  saveLocalMeeting(target);
  return target;
}

/**
 * Exporta todas as reuniões da conta atual em formato JSON para backup seguro
 */
export function exportMeetingsBackupJson(): string {
  const account = getCurrentAccount();
  const meetings = getLocalMeetings();
  const payload = {
    app: "Marca Meet",
    version: "2.0",
    exported_at: new Date().toISOString(),
    account: account
      ? {
          id: account.id,
          name: account.name,
          email: account.email,
          company: account.company,
        }
      : null,
    meetings_count: meetings.length,
    meetings,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Importa e restaura reuniões de um arquivo de backup JSON na conta atual
 */
export async function importMeetingsBackupJson(
  jsonText: string
): Promise<{ importedCount: number; totalCount: number }> {
  const parsed = JSON.parse(jsonText);
  const list: CompleteMeetingDetails[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.meetings)
    ? parsed.meetings
    : [];

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("Nenhuma reunião válida encontrada no arquivo de backup.");
  }

  let importedCount = 0;
  const account = getCurrentAccount();

  for (const item of list) {
    if (item?.meeting?.id && item?.meeting?.title) {
      const enriched: CompleteMeetingDetails = {
        ...item,
        meeting: {
          ...item.meeting,
          user_id: account ? account.id : item.meeting.user_id || "u-001",
          user_email: account ? account.email.trim().toLowerCase() : item.meeting.user_email,
        },
      };
      upsertIntoMeetingsMap(enriched);
      await saveCompletedMeetingToIndexedDB(enriched);
      saveMeetingToSupabase(enriched).catch(() => {});
      importedCount++;
    }
  }

  persistMeetingsToLocalStorage(account);
  notifyListeners();
  syncAccountMeetingsNow().catch(() => {});

  return {
    importedCount,
    totalCount: getLocalMeetings().length,
  };
}

export function clearAllLocalMeetings(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY_MEETINGS);
  localStorage.removeItem("marcameet_meetings_v1");
  localStorage.removeItem("marcameet_tasks_v1");
}

export function resetStorageToDefault(): CompleteMeetingDetails[] {
  clearAllLocalMeetings();
  return [];
}
