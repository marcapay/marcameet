import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CompleteMeetingDetails } from '@/types/database';
import { getStoredKey } from '@/lib/storage/keysStorage';

export function getSupabaseClient(): SupabaseClient | null {
  const url = getStoredKey("supa_url", process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = getStoredKey("supa_anon_key", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (url && key && !url.includes("placeholder") && !key.includes("placeholder")) {
    return createClient(url, key);
  }
  return null;
}

export const isSupabaseConfigured = () => {
  return getSupabaseClient() !== null;
};

export const supabase = getSupabaseClient() || createClient('https://placeholder.supabase.co', 'placeholder-anon-key');

/**
 * Exclui a reunião e todos os seus registros associados (cascata) no Supabase (tabela marcameet)
 */
export async function deleteMeetingFromSupabase(meetingId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    // 1. Tentar deletar na tabela principal marcameet
    const { error: errMarcameet } = await client
      .from('marcameet')
      .delete()
      .eq('id', meetingId);

    if (!errMarcameet) {
      console.log(`Reunião ${meetingId} excluída com sucesso da tabela marcameet no Supabase.`);
      return true;
    }

    // 2. Fallback caso a tabela seja meetings
    const { error: errMeetings } = await client
      .from('meetings')
      .delete()
      .eq('id', meetingId);

    if (!errMeetings) {
      console.log(`Reunião ${meetingId} excluída com sucesso da tabela meetings no Supabase.`);
      return true;
    }

    console.warn("Aviso ao deletar reunião no Supabase:", errMarcameet || errMeetings);
    return false;
  } catch (err) {
    console.error("Erro inesperado ao deletar reunião no Supabase:", err);
    return false;
  }
}

/**
 * Salva/sincroniza a reunião e detalhes no Supabase (tabela marcameet)
 */
export async function saveMeetingToSupabase(details: CompleteMeetingDetails): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { meeting, summary, transcript, decisions, tasks } = details;

    // Upsert na tabela marcameet
    const { error: mErr } = await client.from('marcameet').upsert({
      id: meeting.id,
      title: meeting.title,
      description: meeting.description || null,
      meeting_date: meeting.meeting_date,
      duration_seconds: meeting.duration_seconds || 0,
      source_type: meeting.source_type,
      status: meeting.status,
      tags: meeting.tags || [],
    });

    if (mErr) {
      // Fallback para tabela meetings caso exista com esse nome
      await client.from('meetings').upsert({
        id: meeting.id,
        title: meeting.title,
        description: meeting.description || null,
        meeting_date: meeting.meeting_date,
        duration_seconds: meeting.duration_seconds || 0,
        source_type: meeting.source_type,
        status: meeting.status,
        tags: meeting.tags || [],
      });
    }

    // Transcrição
    if (transcript) {
      await client.from('transcripts').upsert({
        id: transcript.id,
        meeting_id: meeting.id,
        raw_text: transcript.raw_text,
        speaker_map: transcript.speaker_map,
      });
    }

    // Resumo
    if (summary) {
      await client.from('meeting_summaries').upsert({
        id: summary.id,
        meeting_id: meeting.id,
        objective: summary.objective,
        key_topics: summary.key_topics,
        conclusions: summary.conclusions,
      });
    }

    return true;
  } catch (err) {
    console.error("Erro ao salvar reunião no Supabase:", err);
    return false;
  }
}
