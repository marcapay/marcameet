import { CompleteMeetingDetails } from "@/types/database";
import { deleteMeetingFromSupabase, saveMeetingToSupabase } from "@/lib/supabase/client";

const STORAGE_KEY_MEETINGS = "marcameet_meetings_v2"; // Chave atualizada para expurgar automaticamente dados antigos do navegador

export const INITIAL_MOCK_MEETINGS: CompleteMeetingDetails[] = [];

export function getLocalMeetings(): CompleteMeetingDetails[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY_MEETINGS);
    if (!data) {
      // Limpar chave antiga v1 caso ainda exista no navegador do usuário
      localStorage.removeItem("marcameet_meetings_v1");
      return [];
    }
    const parsed: CompleteMeetingDetails[] = JSON.parse(data);
    // Filtrar qualquer reunião fictícia de teste (m-101 ou Alinhamento Estratégico)
    const cleanList = parsed.filter(
      (m) =>
        m.meeting.id !== "m-101" &&
        !m.meeting.title.includes("Alinhamento Estratégico Q3") &&
        !m.meeting.title.includes("Exemplo")
    );
    if (cleanList.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(cleanList));
    }
    return cleanList;
  } catch (e) {
    console.error("Erro ao carregar reuniões do localStorage:", e);
    return [];
  }
}

export function saveLocalMeeting(details: CompleteMeetingDetails): void {
  if (typeof window === "undefined") return;
  const current = getLocalMeetings();
  const index = current.findIndex((m) => m.meeting.id === details.meeting.id);
  if (index >= 0) {
    current[index] = details;
  } else {
    current.unshift(details);
  }
  localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(current));

  // Sincronizar criação/atualização no Supabase (tabela marcameet) de forma transparente
  saveMeetingToSupabase(details).catch((err) =>
    console.warn("Falha na sincronização assíncrona com Supabase:", err)
  );
}

export async function deleteLocalMeeting(meetingId: string): Promise<void> {
  if (typeof window === "undefined") return;

  // 1. Excluir do armazenamento local imediatamente
  const current = getLocalMeetings();
  const updated = current.filter((m) => m.meeting.id !== meetingId);
  localStorage.setItem(STORAGE_KEY_MEETINGS, JSON.stringify(updated));

  // 2. Excluir da tabela marcameet no Supabase (com deleção em cascata)
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
