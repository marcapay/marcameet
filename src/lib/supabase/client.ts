import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CompleteMeetingDetails, ActiveMeetingSessionState, AudioChunkMetadata } from '@/types/database';
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

/**
 * Sincroniza o estado da reunião ativa no Supabase (tabela active_meetings)
 */
export async function syncActiveMeetingToSupabase(session: ActiveMeetingSessionState): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client.from('active_meetings').upsert({
      meeting_id: session.meeting_id,
      session_id: session.session_id,
      title: session.title,
      source_type: session.source_type,
      status: session.status,
      started_at: session.started_at,
      last_chunk_at: session.last_chunk_at,
      last_activity_at: new Date().toISOString(),
      ended_at: session.ended_at || null,
      source_status: session.source_status,
      recorder_status: session.recorder_status,
      accumulated_paused_ms: session.accumulated_paused_ms || 0,
      wake_lock_enabled: session.wake_lock_enabled ?? true,
      transcript_draft: session.transcript_draft || '',
      speaker_map: session.speaker_map || {},
      segments_draft: session.segments_draft || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'meeting_id' });

    if (error) {
      console.warn("Aviso ao sincronizar reunião ativa no Supabase:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Erro ao sincronizar reunião ativa no Supabase:", err);
    return false;
  }
}

/**
 * Registra um bloco de áudio no Supabase rejeitando duplicidades (Chave Única: meeting_id + session_id + sequence_number)
 */
export async function uploadAudioChunkDeduplicated(chunk: AudioChunkMetadata): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const chunkId = chunk.id || `${chunk.meeting_id}_${chunk.session_id}_${chunk.sequence_number}`;

    const { error } = await client.from('audio_chunks').upsert({
      id: chunkId,
      meeting_id: chunk.meeting_id,
      session_id: chunk.session_id,
      sequence_number: chunk.sequence_number,
      timestamp_start: chunk.timestamp_start,
      duration_seconds: chunk.duration_seconds || 8.0,
      status: 'uploaded',
      created_at: chunk.created_at || new Date().toISOString(),
    }, { onConflict: 'id' });

    if (error) {
      console.warn("Aviso ao registrar chunk no Supabase (duplicidade/erro):", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Erro ao registrar chunk no Supabase:", err);
    return false;
  }
}

/**
 * Busca uma reunião ativa no Supabase (com status diferente de 'finished')
 */
export async function fetchActiveMeetingFromSupabase(meetingId?: string): Promise<ActiveMeetingSessionState | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    let query = client.from('active_meetings').select('*');
    if (meetingId) {
      query = query.eq('meeting_id', meetingId);
    } else {
      query = query.neq('status', 'finished').order('updated_at', { ascending: false }).limit(1);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;

    const row = data[0];
    return {
      meeting_id: row.meeting_id,
      session_id: row.session_id,
      user_id: row.user_id,
      title: row.title,
      source_type: row.source_type,
      status: row.status,
      started_at: row.started_at,
      started_at_ms: new Date(row.started_at).getTime(),
      last_chunk_at: row.last_chunk_at,
      last_activity_at: row.last_activity_at,
      ended_at: row.ended_at,
      source_status: row.source_status,
      recorder_status: row.recorder_status,
      accumulated_paused_ms: row.accumulated_paused_ms || 0,
      wake_lock_enabled: row.wake_lock_enabled ?? true,
      transcript_draft: row.transcript_draft || '',
      speaker_map: row.speaker_map || {},
      segments_draft: row.segments_draft || [],
    };
  } catch (err) {
    console.warn("Erro ao buscar reunião ativa do Supabase:", err);
    return null;
  }
}

/**
 * Finaliza a reunião ativa no Supabase
 */
export async function closeActiveMeetingInSupabase(meetingId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from('active_meetings')
      .update({
        status: 'finished',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('meeting_id', meetingId);

    return !error;
  } catch (err) {
    console.warn("Erro ao encerrar reunião ativa no Supabase:", err);
    return false;
  }
}

