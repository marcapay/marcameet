import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CompleteMeetingDetails, ActiveMeetingSessionState, AudioChunkMetadata, UserAccount } from '@/types/database';
import { getStoredKey } from '@/lib/storage/keysStorage';

let cachedClient: SupabaseClient | null = null;
let cachedUrl = "";
let cachedKey = "";

export function getSupabaseClient(): SupabaseClient | null {
  const url = getStoredKey("supa_url", process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = getStoredKey("supa_anon_key", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");

  if (url && key && !url.includes("placeholder") && !key.includes("placeholder") && url.startsWith("http")) {
    if (cachedClient && cachedUrl === url && cachedKey === key) {
      return cachedClient;
    }
    try {
      cachedUrl = url;
      cachedKey = key;
      cachedClient = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });
      return cachedClient;
    } catch (e) {
      cachedClient = null;
      return null;
    }
  }
  cachedClient = null;
  return null;
}

export const isSupabaseConfigured = () => {
  return getSupabaseClient() !== null;
};

export const supabase = getSupabaseClient();

/**
 * Salva ou atualiza uma conta de usuário no Supabase (tabela marcameet_users)
 */
export async function saveUserAccountToSupabase(account: UserAccount): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client.from('marcameet_users').upsert({
      id: account.id,
      email: account.email.trim().toLowerCase(),
      name: account.name,
      company: account.company || null,
      password_hash: account.password_hash,
      created_at: account.created_at,
      updated_at: account.updated_at,
      last_login_at: account.last_login_at,
    }, { onConflict: 'email' });

    if (error) {
      // Se a tabela marcameet_users ainda não existir, tentar salvar no Supabase Auth
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Busca uma conta de usuário pelo e-mail no Supabase (tabela marcameet_users)
 */
export async function fetchUserAccountFromSupabase(email: string): Promise<UserAccount | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await client
      .from('marcameet_users')
      .select('*')
      .eq('email', normalizedEmail)
      .limit(1);

    if (error || !data || data.length === 0) return null;
    const row = data[0];
    return {
      id: row.id,
      email: row.email,
      name: row.name || normalizedEmail.split('@')[0],
      company: row.company || undefined,
      password_hash: row.password_hash || '',
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
      last_login_at: row.last_login_at || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

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
      return true;
    }

    // 2. Fallback caso a tabela seja meetings
    const { error: errMeetings } = await client
      .from('meetings')
      .delete()
      .eq('id', meetingId);

    if (!errMeetings) {
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
 * Salva/sincroniza a reunião e todos os seus detalhes no Supabase (tabela marcameet)
 */
export async function saveMeetingToSupabase(details: CompleteMeetingDetails): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { meeting, summary, transcript, decisions, tasks } = details;

    // 1. Tentar upsert com suporte a details_json e user_email
    const { error: fullErr } = await client.from('marcameet').upsert({
      id: meeting.id,
      user_id: meeting.user_id || null,
      user_email: meeting.user_email || null,
      title: meeting.title,
      description: meeting.description || null,
      meeting_date: meeting.meeting_date,
      duration_seconds: meeting.duration_seconds || 0,
      source_type: meeting.source_type,
      status: meeting.status,
      tags: meeting.tags || [],
      details_json: details,
      updated_at: new Date().toISOString(),
    });

    if (fullErr) {
      // 2. Fallback caso a tabela marcameet ainda não tenha as colunas details_json / user_email
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
    }

    // 3. Salvar também nas tabelas relacionais para consultas SQL diretas (e incluir metadados extras no speaker_map para zero perda)
    if (transcript) {
      const enrichedSpeakerMap = {
        ...(transcript.speaker_map || {}),
        __account_meta: {
          user_id: meeting.user_id,
          user_email: meeting.user_email,
        },
        __full_backup: {
          highlights: details.highlights || [],
          decisions: details.decisions || [],
          tasks: details.tasks || [],
          pending_items: details.pending_items || [],
          risks: details.risks || [],
          opportunities: details.opportunities || [],
          values: details.values || [],
          dates: details.dates || [],
          quotes: details.quotes || [],
          next_steps_agreed: details.next_steps_agreed || [],
          next_steps_ai_suggestions: details.next_steps_ai_suggestions || [],
          segments: transcript.segments || [],
        },
      };

      await client.from('transcripts').upsert({
        id: transcript.id,
        meeting_id: meeting.id,
        raw_text: transcript.raw_text,
        speaker_map: enrichedSpeakerMap,
      });
    }

    if (summary) {
      await client.from('meeting_summaries').upsert({
        id: summary.id,
        meeting_id: meeting.id,
        objective: summary.objective,
        key_topics: summary.key_topics,
        conclusions: summary.conclusions,
        final_status: summary.final_status || 'Concluída',
      });
    }

    if (decisions && decisions.length > 0) {
      await client.from('meeting_decisions').upsert(
        decisions.map((d) => ({
          id: d.id,
          meeting_id: meeting.id,
          decision_text: d.decision_text,
          timestamp_start: d.timestamp_start || 0,
          original_snippet: d.original_snippet || null,
        }))
      );
    }

    if (tasks && tasks.length > 0) {
      await client.from('meeting_tasks').upsert(
        tasks.map((t) => ({
          id: t.id,
          meeting_id: meeting.id,
          title: t.title,
          description: t.description || null,
          assignee: t.assignee || 'Responsável não definido',
          original_due_date_text: t.original_due_date_text || null,
          priority: t.priority || 'Média',
          status: t.status || 'Pendente',
          timestamp_start: t.timestamp_start || 0,
        }))
      );
    }

    return true;
  } catch (err) {
    console.error("Erro ao salvar reunião no Supabase:", err);
    return false;
  }
}

/**
 * Busca e reconstrói todas as reuniões salvas no Supabase (filtrando pela conta do usuário quando aplicável)
 */
export async function fetchMeetingsFromSupabase(userId?: string, userEmail?: string): Promise<CompleteMeetingDetails[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data: rows, error } = await client
      .from('marcameet')
      .select('*')
      .order('meeting_date', { ascending: false })
      .limit(100);

    if (error || !rows || rows.length === 0) return [];

    // Buscar tabelas auxiliares para reconstruir reuniões que não tenham details_json
    const meetingIds = rows.map((r: any) => r.id);
    const [transcriptsRes, summariesRes, decisionsRes, tasksRes] = await Promise.all([
      client.from('transcripts').select('*').in('meeting_id', meetingIds),
      client.from('meeting_summaries').select('*').in('meeting_id', meetingIds),
      client.from('meeting_decisions').select('*').in('meeting_id', meetingIds),
      client.from('meeting_tasks').select('*').in('meeting_id', meetingIds),
    ]);

    const transcriptsMap = new Map<string, any>();
    (transcriptsRes.data || []).forEach((t: any) => transcriptsMap.set(t.meeting_id, t));

    const summariesMap = new Map<string, any>();
    (summariesRes.data || []).forEach((s: any) => summariesMap.set(s.meeting_id, s));

    const decisionsMap = new Map<string, any[]>();
    (decisionsRes.data || []).forEach((d: any) => {
      const list = decisionsMap.get(d.meeting_id) || [];
      list.push(d);
      decisionsMap.set(d.meeting_id, list);
    });

    const tasksMap = new Map<string, any[]>();
    (tasksRes.data || []).forEach((t: any) => {
      const list = tasksMap.get(t.meeting_id) || [];
      list.push(t);
      tasksMap.set(t.meeting_id, list);
    });

    const reconstructed: CompleteMeetingDetails[] = [];

    for (const row of rows) {
      // Se já tiver details_json salvo diretamente na linha
      if (row.details_json && typeof row.details_json === 'object' && row.details_json.meeting) {
        const d = row.details_json as CompleteMeetingDetails;
        reconstructed.push(d);
        continue;
      }

      const tRow = transcriptsMap.get(row.id);
      const sRow = summariesMap.get(row.id);
      const dRows = decisionsMap.get(row.id) || [];
      const tkRows = tasksMap.get(row.id) || [];

      const rawSpeakerMap = { ...(tRow?.speaker_map || {}) };
      const accountMeta = rawSpeakerMap.__account_meta || {};
      const fullBackup = rawSpeakerMap.__full_backup || {};
      delete rawSpeakerMap.__account_meta;
      delete rawSpeakerMap.__full_backup;

      const resolvedUserId = row.user_id || accountMeta.user_id || userId || 'u-001';
      const resolvedUserEmail = row.user_email || accountMeta.user_email || userEmail || undefined;

      const details: CompleteMeetingDetails = {
        meeting: {
          id: row.id,
          user_id: resolvedUserId,
          user_email: resolvedUserEmail,
          title: row.title || 'Reunião Salva',
          description: row.description || null,
          meeting_date: row.meeting_date || row.created_at || new Date().toISOString(),
          duration_seconds: row.duration_seconds || 0,
          source_type: row.source_type || 'recording',
          status: row.status || 'CONCLUIDA',
          error_message: row.error_message || null,
          tags: Array.isArray(row.tags) ? row.tags : [],
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || new Date().toISOString(),
        },
        transcript: tRow
          ? {
              id: tRow.id,
              meeting_id: row.id,
              raw_text: tRow.raw_text || '',
              speaker_map: rawSpeakerMap,
              segments: fullBackup.segments || [],
            }
          : undefined,
        summary: sRow
          ? {
              id: sRow.id,
              meeting_id: row.id,
              objective: sRow.objective || '',
              key_topics: Array.isArray(sRow.key_topics) ? sRow.key_topics : [],
              conclusions: sRow.conclusions || '',
              final_status: sRow.final_status || 'Concluída',
            }
          : undefined,
        highlights: fullBackup.highlights || [],
        decisions: fullBackup.decisions || dRows,
        tasks: fullBackup.tasks || tkRows,
        pending_items: fullBackup.pending_items || [],
        risks: fullBackup.risks || [],
        opportunities: fullBackup.opportunities || [],
        values: fullBackup.values || [],
        dates: fullBackup.dates || [],
        quotes: fullBackup.quotes || [],
        next_steps_agreed: fullBackup.next_steps_agreed || [],
        next_steps_ai_suggestions: fullBackup.next_steps_ai_suggestions || [],
      };

      reconstructed.push(details);
    }

    // Filtrar por conta se userId ou userEmail forem informados (incluindo reuniões legadas sem dono para migração)
    if (userId || userEmail) {
      const normalizedEmail = userEmail?.trim().toLowerCase();
      return reconstructed.filter((item) => {
        const mUserId = item.meeting.user_id;
        const mEmail = item.meeting.user_email?.trim().toLowerCase();
        const isUnowned = !mUserId || mUserId === 'u-001' || mUserId === 'anonymous';
        const matchesId = userId && mUserId === userId;
        const matchesEmail = normalizedEmail && mEmail === normalizedEmail;
        return matchesId || matchesEmail || isUnowned;
      });
    }

    return reconstructed;
  } catch (err) {
    console.warn("Aviso ao buscar reuniões do Supabase:", err);
    return [];
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
