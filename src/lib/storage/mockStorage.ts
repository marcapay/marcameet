import { CompleteMeetingDetails, UserAccount } from "@/types/database";
import {
  ensureValidUuid,
} from "@/lib/supabase/client";
import {
  saveCompletedMeetingToIndexedDB,
  getCompletedMeetingsFromIndexedDB,
  deleteCompletedMeetingFromIndexedDB,
  clearActiveSessionInIndexedDB,
  requestPersistentBrowserStorage,
} from "@/lib/storage/indexedDbQueue";
import { removeProtectedMeeting } from "@/lib/supabase/meetingAccess";
import { getCurrentAccount, subscribeAccountChange } from "@/lib/auth/accountSystem";
import { clearSessionChunks, deleteMeetingAudioBlob } from "@/lib/recording/chunkStore";

const STORAGE_KEY_MEETINGS = "marcameet_meetings_v2";
const DELETION_PREFIX = "marcameet_deleted_meeting_";
const deletionRecords = new Map<string, { id: string; pending: boolean; requiresSupabase?: boolean }>();

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
  const aTime = new Date(a.meeting.updated_at || a.meeting.meeting_date || 0).getTime();
  const bTime = new Date(b.meeting.updated_at || b.meeting.meeting_date || 0).getTime();
  const latest = aHasSummary === bHasSummary ? (bTime >= aTime ? b : a) : (bHasSummary ? b : a);
  const localMaterials = b.support_materials ?? a.support_materials;
  return localMaterials ? { ...latest, support_materials: localMaterials } : latest;
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
    return dedupedList.filter(({ meeting }) => !meeting.user_email && isAnonymousUserId(meeting.user_id)).sort(
      (a, b) => new Date(b.meeting.meeting_date).getTime() - new Date(a.meeting.meeting_date).getTime()
    );
  }

  const cleanEmail = account.email.trim().toLowerCase();
  const accountUuid = ensureValidUuid(account.id, `marcameet_user:${cleanEmail}`);

  return dedupedList
    .filter((m) => {
      const mUserId = m.meeting.user_id;
      const mEmail = m.meeting.user_email?.trim().toLowerCase();
      if (mEmail) return mEmail === cleanEmail;
      return Boolean(mUserId && !isAnonymousUserId(mUserId) &&
        (mUserId === account.id || ensureValidUuid(mUserId) === accountUuid));
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
    syncedCloud: false,
  };
}

// Ouvir mudanças de conta e eventos de foco/visibilidade para manter celular e computador sempre sincronizados
if (typeof window !== "undefined") {
  subscribeAccountChange((account) => {
    if (account) {
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


}

export async function deleteLocalMeeting(meetingId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const selected = getLocalMeetings().find(({ meeting }) => ensureValidUuid(meeting.id) === ensureValidUuid(meetingId));
  if (!selected || !await removeProtectedMeeting(selected).catch(() => false)) return false;
  rememberDeletion(meetingId, false);
  const ids = discardCachedMeeting(meetingId);
  persistMeetingsToLocalStorage(getCurrentAccount());
  notifyListeners();

  try {
    await removeMeetingFiles(ids);
    return true;
  } catch {
    return false;
  }
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
    app: "Marca Reuniões",
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
