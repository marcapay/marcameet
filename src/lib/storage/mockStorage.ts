import { CompleteMeetingDetails, UserAccount } from "@/types/database";
import {
  deleteMeetingFromSupabase,
  saveMeetingToSupabase,
  fetchMeetingsFromSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  saveCompletedMeetingToIndexedDB,
  getCompletedMeetingsFromIndexedDB,
  deleteCompletedMeetingFromIndexedDB,
  requestPersistentBrowserStorage,
} from "@/lib/storage/indexedDbQueue";
import { getCurrentAccount, subscribeAccountChange } from "@/lib/auth/accountSystem";

const STORAGE_KEY_MEETINGS = "marcameet_meetings_v2";
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
  return false;
}

function isAnonymousUserId(userId?: string): boolean {
  return !userId || userId === "u-001" || userId === "anonymous" || userId === "guest";
}

function filterMeetingsForCurrentUser(allList: CompleteMeetingDetails[], account: UserAccount | null): CompleteMeetingDetails[] {
  const valid = allList.filter((m) => !isLegacyMockMeeting(m));

  if (!account) {
    // Mesmo sem login ativo, exibe as reuniões salvas localmente no dispositivo para nunca sumirem da tela
    return valid.sort(
      (a, b) => new Date(b.meeting.meeting_date).getTime() - new Date(a.meeting.meeting_date).getTime()
    );
  }

  const cleanEmail = account.email.trim().toLowerCase();
  return valid
    .filter((m) => {
      const mUserId = m.meeting.user_id;
      const mEmail = m.meeting.user_email?.trim().toLowerCase();
      return (
        mUserId === account.id ||
        (mEmail && mEmail === cleanEmail) ||
        isAnonymousUserId(mUserId)
      );
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
  const allList = Array.from(allMeetingsMap.values()).filter((m) => !isLegacyMockMeeting(m));
  allList.sort((a, b) => new Date(b.meeting.meeting_date).getTime() - new Date(a.meeting.meeting_date).getTime());

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
 * Adota reuniões locais anônimas ("u-001") para a conta logada e sincroniza com IndexedDB e Nuvem
 */
function adoptAnonymousMeetingsForAccount(account: UserAccount): boolean {
  let adoptedAny = false;
  allMeetingsMap.forEach((item, id) => {
    if (isAnonymousUserId(item.meeting.user_id) || !item.meeting.user_email) {
      const updated: CompleteMeetingDetails = {
        ...item,
        meeting: {
          ...item.meeting,
          user_id: isAnonymousUserId(item.meeting.user_id) ? account.id : item.meeting.user_id,
          user_email: item.meeting.user_email || account.email,
        },
      };
      allMeetingsMap.set(id, updated);
      saveCompletedMeetingToIndexedDB(updated).catch(() => {});
      saveMeetingToSupabase(updated).catch(() => {});
      adoptedAny = true;
    }
  });
  return adoptedAny;
}

/**
 * Sincroniza reuniões da conta com IndexedDB e Supabase Cloud
 */
export async function syncAccountMeetingsNow(): Promise<{ totalSaved: number; syncedCloud: boolean }> {
  if (typeof window === "undefined") return { totalSaved: 0, syncedCloud: false };

  await requestPersistentBrowserStorage().catch(() => {});
  const account = getCurrentAccount();

  // 1. Ler do IndexedDB
  try {
    const idbMeetings = await getCompletedMeetingsFromIndexedDB();
    idbMeetings.forEach((item) => {
      if (item?.meeting?.id && !isLegacyMockMeeting(item)) {
        const existing = allMeetingsMap.get(item.meeting.id);
        if (!existing || new Date(item.meeting.updated_at || 0) >= new Date(existing.meeting.updated_at || 0)) {
          allMeetingsMap.set(item.meeting.id, item);
        }
      }
    });
  } catch {}

  // 2. Ler do cache específico da conta no localStorage
  if (account) {
    try {
      const rawAcc = localStorage.getItem(getAccountStorageKey(account.id));
      if (rawAcc) {
        const parsedAcc = JSON.parse(rawAcc) as CompleteMeetingDetails[];
        parsedAcc.forEach((item) => {
          if (item?.meeting?.id && !isLegacyMockMeeting(item) && !allMeetingsMap.has(item.meeting.id)) {
            allMeetingsMap.set(item.meeting.id, item);
          }
        });
      }
    } catch {}

    adoptAnonymousMeetingsForAccount(account);
  }

  // 3. Sincronizar com Supabase se configurado
  let syncedCloud = false;
  if (isSupabaseConfigured()) {
    try {
      const cloudMeetings = await fetchMeetingsFromSupabase(account?.id, account?.email);
      cloudMeetings.forEach((cloudItem) => {
        if (cloudItem?.meeting?.id && !isLegacyMockMeeting(cloudItem)) {
          const localItem = allMeetingsMap.get(cloudItem.meeting.id);
          // Se não existe localmente, ou se o local não tinha transcrição/resumo completo
          if (!localItem) {
            allMeetingsMap.set(cloudItem.meeting.id, cloudItem);
            saveCompletedMeetingToIndexedDB(cloudItem).catch(() => {});
          }
        }
      });

      // Enviar reuniões locais da conta para o Supabase para garantir backup em nuvem
      const currentList = filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), account);
      await Promise.all(
        currentList.slice(0, 30).map((m) =>
          saveMeetingToSupabase(m).catch(() => false)
        )
      );
      syncedCloud = true;
    } catch {}
  }

  // 4. Garantir que todas as reuniões em memória estejam salvas no IndexedDB e localStorage
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

// Ouvir mudanças de login/logout na conta para sincronizar imediatamente as reuniões do usuário
if (typeof window !== "undefined") {
  subscribeAccountChange((account) => {
    if (account) {
      adoptAnonymousMeetingsForAccount(account);
      persistMeetingsToLocalStorage(account);
    }
    notifyListeners();
    syncAccountMeetingsNow().catch(() => {});
  });
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
          if (m?.meeting?.id && !isLegacyMockMeeting(m)) {
            allMeetingsMap.set(m.meeting.id, m);
          }
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
          if (m?.meeting?.id && !isLegacyMockMeeting(m) && !allMeetingsMap.has(m.meeting.id)) {
            allMeetingsMap.set(m.meeting.id, m);
          }
        });
      }
    } catch {}

    if (adoptAnonymousMeetingsForAccount(account)) {
      persistMeetingsToLocalStorage(account);
    }
  }

  // Sincronizar assincronamente com IndexedDB e Supabase na inicialização ou ao trocar de conta
  if (!hasSyncedIndexedDB || (account && lastSyncedAccountId !== account.id)) {
    hasSyncedIndexedDB = true;
    lastSyncedAccountId = account?.id || null;
    syncAccountMeetingsNow().catch(() => {});
  }

  return filterMeetingsForCurrentUser(Array.from(allMeetingsMap.values()), account);
}

export function saveLocalMeeting(details: CompleteMeetingDetails): void {
  if (typeof window === "undefined" || !details?.meeting?.id) return;

  const account = getCurrentAccount();

  // Vincular automaticamente à conta logada
  const enrichedDetails: CompleteMeetingDetails = {
    ...details,
    meeting: {
      ...details.meeting,
      user_id: account ? account.id : details.meeting.user_id || "u-001",
      user_email: account ? account.email : details.meeting.user_email,
      updated_at: new Date().toISOString(),
    },
    tasks: (details.tasks || []).map((t) => ({
      ...t,
      user_id: account ? account.id : t.user_id || "u-001",
    })),
  };

  // 1. Atualizar cache em memória
  allMeetingsMap.set(enrichedDetails.meeting.id, enrichedDetails);
  notifyListeners();

  // 2. Salvar no localStorage (geral e da conta) com proteção a QuotaExceededError
  persistMeetingsToLocalStorage(account);

  // 3. Salvar no IndexedDB (armazenamento permanente sem limite de cota)
  saveCompletedMeetingToIndexedDB(enrichedDetails).catch((err) =>
    console.warn("Falha ao salvar reunião no IndexedDB local:", err)
  );

  // 4. Sincronizar criação/atualização no Supabase de forma transparente
  saveMeetingToSupabase(enrichedDetails).catch((err) =>
    console.warn("Falha na sincronização assíncrona com Supabase:", err)
  );
}

export async function deleteLocalMeeting(meetingId: string): Promise<void> {
  if (typeof window === "undefined") return;

  const account = getCurrentAccount();

  // 1. Excluir da memória e do localStorage
  allMeetingsMap.delete(meetingId);
  persistMeetingsToLocalStorage(account);
  notifyListeners();

  // 2. Excluir do IndexedDB
  await deleteCompletedMeetingFromIndexedDB(meetingId);

  // 3. Excluir da tabela marcameet no Supabase
  await deleteMeetingFromSupabase(meetingId);
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
          user_email: account ? account.email : item.meeting.user_email,
        },
      };
      allMeetingsMap.set(enriched.meeting.id, enriched);
      await saveCompletedMeetingToIndexedDB(enriched);
      saveMeetingToSupabase(enriched).catch(() => {});
      importedCount++;
    }
  }

  persistMeetingsToLocalStorage(account);
  notifyListeners();

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
