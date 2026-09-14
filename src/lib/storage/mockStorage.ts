import { CompleteMeetingDetails } from "@/types/database";
import { deleteMeetingFromSupabase, saveMeetingToSupabase } from "@/lib/supabase/client";
import {
  saveCompletedMeetingToIndexedDB,
  getCompletedMeetingsFromIndexedDB,
  deleteCompletedMeetingFromIndexedDB,
} from "@/lib/storage/indexedDbQueue";

const STORAGE_KEY_MEETINGS = "marcameet_meetings_v2";

export const INITIAL_MOCK_MEETINGS: CompleteMeetingDetails[] = [];

// Cache em memória para celular (evita perda se o localStorage estourar ou for limpo pelo sistema)
let inMemoryMeetingsCache: CompleteMeetingDetails[] = [];

export function getLocalMeetings(): CompleteMeetingDetails[] {
  if (typeof window === "undefined") return [];

  let listFromStorage: CompleteMeetingDetails[] = [];
  try {
    const data = localStorage.getItem(STORAGE_KEY_MEETINGS);
    if (data) {
      listFromStorage = JSON.parse(data);
    }
  } catch (e) {
    console.error("Erro ao carregar reuniões do localStorage:", e);
  }

  // Combinar inMemory, localStorage e filtrar reuniões de teste antigas
  const mergedMap = new Map<string, CompleteMeetingDetails>();

  inMemoryMeetingsCache.forEach((m) => {
    if (m?.meeting?.id) mergedMap.set(m.meeting.id, m);
  });

  listFromStorage.forEach((m) => {
    if (m?.meeting?.id && !mergedMap.has(m.meeting.id)) {
      mergedMap.set(m.meeting.id, m);
    }
  });

  const cleanList = Array.from(mergedMap.values()).filter(
    (m) =>
      m?.meeting?.id &&
      m.meeting.id !== "m-101" &&
      !m.meeting.title.includes("Alinhamento Estratégico Q3") &&
      !m.meeting.title.includes("Exemplo")
  );

  // Atualizar cache em memória
  inMemoryMeetingsCache = cleanList;

  // Carregar assincronamente do IndexedDB para mesclar se o navegador no celular limpou o localStorage
  if (typeof window !== "undefined") {
    getCompletedMeetingsFromIndexedDB().then((idbMeetings) => {
      if (idbMeetings && idbMeetings.length > 0) {
        let hasNew = false;
        idbMeetings.forEach((idbItem) => {
          if (idbItem?.meeting?.id && !mergedMap.has(idbItem.meeting.id)) {
            mergedMap.set(idbItem.meeting.id, idbItem);
            hasNew = true;
          }
        });
        if (hasNew) {
          const updatedFull = Array.from(mergedMap.values());
          inMemoryMeetingsCache = updatedFull;
          try {
            localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(updatedFull.slice(0, 20)));
          } catch (e) {}
        }
      }
    }).catch(() => {});
  }

  return cleanList;
}

export function saveLocalMeeting(details: CompleteMeetingDetails): void {
  if (typeof window === "undefined" || !details?.meeting?.id) return;

  const current = getLocalMeetings();
  const index = current.findIndex((m) => m.meeting.id === details.meeting.id);
  if (index >= 0) {
    current[index] = details;
  } else {
    current.unshift(details);
  }

  // 1. Atualizar cache em memória
  inMemoryMeetingsCache = current;

  // 2. Salvar no localStorage com proteção total a QuotaExceededError (comum em navegadores de celular)
  try {
    localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(current));
  } catch (e) {
    console.warn("QuotaExceededError no localStorage do celular. Reduzindo histórico salvo no localStorage...", e);
    try {
      // Manter apenas as 10 reuniões mais recentes no localStorage se o celular tiver cota restrita
      const compact = current.slice(0, 10);
      localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(compact));
    } catch (e2) {
      console.error("Erro crítico ao salvar no localStorage no celular:", e2);
    }
  }

  // 3. Salvar no IndexedDB (armazenamento robusto e com cota ilimitada no celular)
  saveCompletedMeetingToIndexedDB(details).catch((err) =>
    console.warn("Falha ao salvar reunião no IndexedDB local do celular:", err)
  );

  // 4. Sincronizar criação/atualização no Supabase (tabela marcameet) de forma transparente
  saveMeetingToSupabase(details).catch((err) =>
    console.warn("Falha na sincronização assíncrona com Supabase:", err)
  );
}

export async function deleteLocalMeeting(meetingId: string): Promise<void> {
  if (typeof window === "undefined") return;

  // 1. Excluir do armazenamento local e em memória
  inMemoryMeetingsCache = inMemoryMeetingsCache.filter((m) => m.meeting.id !== meetingId);
  const current = getLocalMeetings();
  const updated = current.filter((m) => m.meeting.id !== meetingId);
  try {
    localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(updated));
  } catch (e) {}

  // 2. Excluir do IndexedDB
  await deleteCompletedMeetingFromIndexedDB(meetingId);

  // 3. Excluir da tabela marcameet no Supabase
  await deleteMeetingFromSupabase(meetingId);
}

export function updateSpeakerNameInMeeting(meetingId: string, oldSpeaker: string, newSpeaker: string): CompleteMeetingDetails | null {
  const current = getLocalMeetings();
  const target = current.find((m) => m.meeting.id === meetingId);
  if (!target || !target.transcript) return null;

  // Update speaker_map
  target.transcript.speaker_map[oldSpeaker] = newSpeaker;

  // Update in segments
  if (target.transcript.segments) {
    target.transcript.segments = target.transcript.segments.map((seg) => {
      if (seg.speaker === oldSpeaker) {
        return { ...seg, speaker: newSpeaker };
      }
      return seg;
    });
  }

  // Update quotes
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
