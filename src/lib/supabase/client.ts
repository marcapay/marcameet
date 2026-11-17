import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CompleteMeetingDetails, ActiveMeetingSessionState, AudioChunkMetadata, UserAccount } from '@/types/database';
import { getStoredKey, setStoredKey } from '@/lib/storage/keysStorage';

const DEFAULT_SUPABASE_URL = "https://xuooojiaslhwaejsgjxh.supabase.co";

let cachedClient: SupabaseClient | null = null;
let cachedUrl = "";
let cachedKey = "";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Converte qualquer identificador (ex: "m-173...", "usr_...", email) em um UUID v4 válido e determinístico.
 * Garante 100% de compatibilidade com colunas do tipo UUID ou TEXT no PostgreSQL/Supabase.
 */
export function ensureValidUuid(input?: string | null, fallbackSeed = "default"): string {
  const clean = (input || "").trim();
  if (UUID_REGEX.test(clean)) {
    return clean.toLowerCase();
  }
  const seed = clean || fallbackSeed;
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  let h3 = 0x811c9dc5 ^ seed.length;
  let h4 = 0xc9dc5118 ^ seed.length;

  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 0x01000193);
    h4 = Math.imul(h4 ^ ch, 0x5bd1e995);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  const hex3 = (h3 >>> 0).toString(16).padStart(8, "0");
  const hex4 = (h4 >>> 0).toString(16).padStart(8, "0");

  return `${hex1}-${hex2.slice(0, 4)}-4${hex2.slice(5, 8)}-8${hex3.slice(1, 4)}-${hex3.slice(4, 8)}${hex4}`;
}

export function getSupabaseClient(): SupabaseClient | null {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const fallbackUrl = envUrl && !envUrl.includes("placeholder") ? envUrl : DEFAULT_SUPABASE_URL;
  const url = getStoredKey("supa_url", fallbackUrl) || DEFAULT_SUPABASE_URL;
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
 * Salva ou atualiza uma conta de usuário no Supabase (tabela marcameet_users E registro espelho em marcameet + transcripts)
 */
export async function saveUserAccountToSupabase(account: UserAccount): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const accountUuid = ensureValidUuid(account.id, `marcameet_user:${account.email.trim().toLowerCase()}`);
  const cleanEmail = account.email.trim().toLowerCase();

  try {
    await client.from('marcameet_users').upsert({
      id: accountUuid,
      email: cleanEmail,
      name: account.name,
      company: account.company || null,
      password_hash: account.password_hash,
      created_at: account.created_at,
      updated_at: account.updated_at,
      last_login_at: account.last_login_at,
    }, { onConflict: 'email' });
  } catch {}

  try {
    const profileRowId = ensureValidUuid(`account_profile:${cleanEmail}`);
    const { error } = await client.from('marcameet').upsert({
      id: profileRowId,
      user_id: accountUuid,
      title: account.name,
      description: cleanEmail,
      meeting_date: account.created_at || new Date().toISOString(),
      duration_seconds: 0,
      source_type: 'recording',
      status: 'CONCLUIDA',
      error_message: account.password_hash,
      tags: ['__account_profile__', cleanEmail, account.company || ''],
      updated_at: new Date().toISOString(),
    });

    // Salvar também metadados completos da conta + chaves de API configuradas no dispositivo em transcripts
    const transcriptAccId = ensureValidUuid(`t-acc-${cleanEmail}`);
    await client.from('transcripts').upsert({
      id: transcriptAccId,
      meeting_id: profileRowId,
      raw_text: 'ACCOUNT_PROFILE',
      speaker_map: {
        __is_account_profile: true,
        account: {
          ...account,
          id: accountUuid,
          email: cleanEmail,
        },
        keys: {
          ai_openai_key: getStoredKey("ai_openai_key"),
          ai_gemini_key: getStoredKey("ai_gemini_key"),
          ai_groq_key: getStoredKey("ai_groq_key"),
        },
      },
    });

    return !error;
  } catch {
    return false;
  }
}

function restoreKeysFromAccountMetadata(keysObj: any) {
  if (!keysObj || typeof window === "undefined") return;
  if (keysObj.ai_openai_key && !getStoredKey("ai_openai_key")) {
    setStoredKey("ai_openai_key", keysObj.ai_openai_key);
  }
  if (keysObj.ai_gemini_key && !getStoredKey("ai_gemini_key")) {
    setStoredKey("ai_gemini_key", keysObj.ai_gemini_key);
  }
  if (keysObj.ai_groq_key && !getStoredKey("ai_groq_key")) {
    setStoredKey("ai_groq_key", keysObj.ai_groq_key);
  }
}

/**
 * Lista todas as contas já cadastradas no Supabase (marcameet_users, perfis em marcameet e metadados em transcripts)
 */
export async function fetchAllAccountsFromSupabase(): Promise<UserAccount[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const accountsMap = new Map<string, UserAccount>();

  // 1. Buscar de marcameet_users se existir
  try {
    const { data, error } = await client.from('marcameet_users').select('*').limit(100);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (row.email) {
          const email = row.email.trim().toLowerCase();
          accountsMap.set(email, {
            id: ensureValidUuid(row.id, `marcameet_user:${email}`),
            email,
            name: row.name || email.split('@')[0],
            company: row.company || undefined,
            password_hash: row.password_hash || '',
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.updated_at || new Date().toISOString(),
            last_login_at: row.last_login_at || new Date().toISOString(),
          });
        }
      }
    }
  } catch {}

  // 2. Buscar de marcameet e transcripts
  try {
    const { data: rows } = await client
      .from('marcameet')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (Array.isArray(rows)) {
      for (const row of rows) {
        const isProfileRow =
          row.source_type === 'account_profile' ||
          (Array.isArray(row.tags) && row.tags.includes('__account_profile__'));

        if (isProfileRow && row.description && row.description.includes('@')) {
          const email = row.description.trim().toLowerCase();
          if (!accountsMap.has(email)) {
            accountsMap.set(email, {
              id: ensureValidUuid(row.user_id, `marcameet_user:${email}`),
              email,
              name: row.title || email.split('@')[0],
              company: Array.isArray(row.tags) && row.tags[2] ? row.tags[2] : undefined,
              password_hash: row.error_message || '',
              created_at: row.created_at || new Date().toISOString(),
              updated_at: row.updated_at || new Date().toISOString(),
              last_login_at: row.updated_at || new Date().toISOString(),
            });
          }
        }
      }
    }

    const { data: tRows } = await client
      .from('transcripts')
      .select('speaker_map')
      .limit(100);

    if (Array.isArray(tRows)) {
      for (const t of tRows) {
        const sm = t?.speaker_map;
        if (sm?.__is_account_profile && sm?.account?.email) {
          const email = sm.account.email.trim().toLowerCase();
          accountsMap.set(email, {
            id: ensureValidUuid(sm.account.id, `marcameet_user:${email}`),
            email,
            name: sm.account.name || email.split('@')[0],
            company: sm.account.company || undefined,
            password_hash: sm.account.password_hash || '',
            created_at: sm.account.created_at || new Date().toISOString(),
            updated_at: sm.account.updated_at || new Date().toISOString(),
            last_login_at: sm.account.last_login_at || new Date().toISOString(),
          });
          restoreKeysFromAccountMetadata(sm.keys);
        } else if (sm?.__account_meta?.user_email) {
          const email = sm.__account_meta.user_email.trim().toLowerCase();
          if (!accountsMap.has(email)) {
            accountsMap.set(email, {
              id: ensureValidUuid(sm.__account_meta.user_id, `marcameet_user:${email}`),
              email,
              name: email.split('@')[0],
              password_hash: '',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              last_login_at: new Date().toISOString(),
            });
          }
        }
      }
    }
  } catch {}

  return Array.from(accountsMap.values());
}

/**
 * Busca uma conta de usuário pelo e-mail no Supabase
 */
export async function fetchUserAccountFromSupabase(email: string): Promise<UserAccount | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const all = await fetchAllAccountsFromSupabase();
  return all.find((a) => a.email.toLowerCase() === normalizedEmail) || null;
}

/**
 * Exclui a reunião e todos os seus registros associados (cascata) no Supabase (tabela marcameet)
 */
export async function deleteMeetingFromSupabase(meetingId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const validMeetingUuid = ensureValidUuid(meetingId);

  try {
    const { error: errMarcameet } = await client
      .from('marcameet')
      .delete()
      .in('id', [validMeetingUuid, meetingId]);

    if (!errMarcameet) {
      return true;
    }

    const { error: errMeetings } = await client
      .from('meetings')
      .delete()
      .in('id', [validMeetingUuid, meetingId]);

    return !errMeetings;
  } catch (err) {
    console.error("Erro inesperado ao deletar reunião no Supabase:", err);
    return false;
  }
}

/**
 * Salva/atualiza em tempo real a transcrição parcial e os segmentos da reunião no Supabase vinculados à conta da pessoa
 */
export async function saveLiveTranscriptToSupabase(params: {
  meetingId: string;
  userId?: string;
  userEmail?: string;
  title: string;
  sourceType: string;
  durationSeconds: number;
  rawText: string;
  speakerMap?: Record<string, string>;
  segments?: Array<{ start_time: number; end_time?: number; speaker: string; text: string }>;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const meetingUuid = ensureValidUuid(params.meetingId);
  const userUuid = params.userId && params.userId !== 'u-001'
    ? ensureValidUuid(params.userId)
    : params.userEmail
    ? ensureValidUuid(`marcameet_user:${params.userEmail.trim().toLowerCase()}`)
    : null;

  try {
    // 1. Garantir que a reunião já exista na tabela marcameet vinculada ao user_id da conta
    await client.from('marcameet').upsert({
      id: meetingUuid,
      user_id: userUuid,
      title: params.title || 'Reunião em Andamento',
      description: 'Transcrição sendo salva em tempo real na conta.',
      meeting_date: new Date().toISOString(),
      duration_seconds: params.durationSeconds || 0,
      source_type: params.sourceType || 'recording',
      status: 'TRANSCREVENDO',
      tags: ['Em Gravação'],
      updated_at: new Date().toISOString(),
    });

    // 2. Salvar/atualizar a transcrição na tabela transcripts
    const transcriptUuid = ensureValidUuid(`t-${meetingUuid}`);
    const enrichedSpeakerMap = {
      ...(params.speakerMap || { 'Participante 1': 'Participante 1' }),
      __account_meta: {
        user_id: userUuid,
        user_email: params.userEmail || null,
        original_meeting_id: params.meetingId,
      },
    };

    await client.from('transcripts').upsert({
      id: transcriptUuid,
      meeting_id: meetingUuid,
      raw_text: params.rawText || 'Transcrevendo áudio...',
      speaker_map: enrichedSpeakerMap,
    });

    // 3. Salvar trechos na tabela transcript_segments se houver
    if (params.segments && params.segments.length > 0) {
      const segRows = params.segments.map((seg, idx) => ({
        id: ensureValidUuid(`seg-${meetingUuid}-${idx}`),
        transcript_id: transcriptUuid,
        meeting_id: meetingUuid,
        start_time: Number(seg.start_time || 0),
        end_time: Number(seg.end_time ?? (Number(seg.start_time || 0) + 5)),
        speaker: seg.speaker || 'Participante 1',
        text: seg.text || '',
        confidence: 0.98,
      }));
      await client.from('transcript_segments').upsert(segRows);
    }

    return true;
  } catch (err) {
    console.warn("Aviso ao salvar transcrição em tempo real no Supabase:", err);
    return false;
  }
}

/**
 * Salva/sincroniza a reunião completa, transcrição, segmentos, resumo, decisões e tarefas no Supabase na conta do usuário
 */
export async function saveMeetingToSupabase(details: CompleteMeetingDetails): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { meeting, summary, transcript, decisions, tasks } = details;

    const meetingUuid = ensureValidUuid(meeting.id);
    const userUuid =
      meeting.user_id && meeting.user_id !== 'u-001' && meeting.user_id !== 'anonymous'
        ? ensureValidUuid(meeting.user_id)
        : meeting.user_email
        ? ensureValidUuid(`marcameet_user:${meeting.user_email.trim().toLowerCase()}`)
        : null;

    // 1. Tentar upsert com colunas estendidas (details_json / user_email) caso existam
    const { error: fullErr } = await client.from('marcameet').upsert({
      id: meetingUuid,
      user_id: userUuid,
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
      // 2. Upsert compatível com o schema padrão (UUIDs estritos em id e user_id)
      const { error: mErr } = await client.from('marcameet').upsert({
        id: meetingUuid,
        user_id: userUuid,
        title: meeting.title,
        description: meeting.description || null,
        meeting_date: meeting.meeting_date,
        duration_seconds: meeting.duration_seconds || 0,
        source_type: meeting.source_type,
        status: meeting.status,
        tags: meeting.tags || [],
        updated_at: new Date().toISOString(),
      });

      if (mErr) {
        await client.from('meetings').upsert({
          id: meetingUuid,
          user_id: userUuid,
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

    // 3. Salvar SEMPRE a Transcrição na tabela transcripts e os segmentos em transcript_segments
    const transcriptUuid = ensureValidUuid(transcript?.id || `t-${meetingUuid}`);
    const rawTextToSave =
      transcript?.raw_text ||
      (transcript?.segments && transcript.segments.length > 0
        ? transcript.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n')
        : summary?.objective || meeting.description || 'Reunião salva na conta.');

    const enrichedSpeakerMap = {
      ...(transcript?.speaker_map || { 'Participante 1': 'Participante 1' }),
      __account_meta: {
        user_id: userUuid,
        user_email: meeting.user_email || null,
        original_meeting_id: meeting.id,
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
        segments: transcript?.segments || [],
      },
    };

    await client.from('transcripts').upsert({
      id: transcriptUuid,
      meeting_id: meetingUuid,
      raw_text: rawTextToSave,
      speaker_map: enrichedSpeakerMap,
    });

    if (transcript?.segments && transcript.segments.length > 0) {
      const segRows = transcript.segments.map((seg, idx) => ({
        id: ensureValidUuid(seg.id || `seg-${meetingUuid}-${idx}`),
        transcript_id: transcriptUuid,
        meeting_id: meetingUuid,
        start_time: Number(seg.start_time || 0),
        end_time: Number(seg.end_time ?? (Number(seg.start_time || 0) + 5)),
        speaker: seg.speaker || 'Participante 1',
        text: seg.text || '',
        confidence: seg.confidence ?? 0.98,
      }));
      await client.from('transcript_segments').upsert(segRows);
    }

    // 4. Salvar Resumo Executivo na tabela meeting_summaries
    if (summary) {
      await client.from('meeting_summaries').upsert({
        id: ensureValidUuid(summary.id || `sum-${meetingUuid}`),
        meeting_id: meetingUuid,
        objective: summary.objective,
        key_topics: summary.key_topics || [],
        conclusions: summary.conclusions,
        final_status: summary.final_status || 'Concluída',
      });
    }

    // 5. Salvar Decisões na tabela meeting_decisions
    if (decisions && decisions.length > 0) {
      await client.from('meeting_decisions').upsert(
        decisions.map((d, idx) => ({
          id: ensureValidUuid(d.id || `dec-${meetingUuid}-${idx}`),
          meeting_id: meetingUuid,
          decision_text: d.decision_text,
          timestamp_start: d.timestamp_start || 0,
          original_snippet: d.original_snippet || null,
        }))
      );
    }

    // 6. Salvar Tarefas na tabela meeting_tasks
    if (tasks && tasks.length > 0) {
      await client.from('meeting_tasks').upsert(
        tasks.map((t, idx) => ({
          id: ensureValidUuid(t.id || `task-${meetingUuid}-${idx}`),
          meeting_id: meetingUuid,
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
 * Busca e reconstrói todas as reuniões e transcrições salvas no Supabase na conta do usuário
 */
export async function fetchMeetingsFromSupabase(userId?: string, userEmail?: string): Promise<CompleteMeetingDetails[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data: rows, error } = await client
      .from('marcameet')
      .select('*')
      .neq('source_type', 'account_profile')
      .order('meeting_date', { ascending: false })
      .limit(100);

    if (error || !rows || rows.length === 0) return [];

    // Filtrar linhas de perfil de conta caso tenham tags __account_profile__
    const meetingRows = rows.filter(
      (r: any) =>
        r.source_type !== 'account_profile' &&
        !(Array.isArray(r.tags) && r.tags.includes('__account_profile__'))
    );

    if (meetingRows.length === 0) return [];

    const meetingIds = meetingRows.map((r: any) => r.id);
    const [transcriptsRes, segmentsRes, summariesRes, decisionsRes, tasksRes] = await Promise.all([
      client.from('transcripts').select('*').in('meeting_id', meetingIds),
      client.from('transcript_segments').select('*').in('meeting_id', meetingIds).order('start_time', { ascending: true }),
      client.from('meeting_summaries').select('*').in('meeting_id', meetingIds),
      client.from('meeting_decisions').select('*').in('meeting_id', meetingIds),
      client.from('meeting_tasks').select('*').in('meeting_id', meetingIds),
    ]);

    const transcriptsMap = new Map<string, any>();
    (transcriptsRes.data || []).forEach((t: any) => {
      if (t?.speaker_map?.__is_audio_storage || t?.speaker_map?.__is_account_profile) return;
      transcriptsMap.set(t.meeting_id, t);
    });

    const segmentsMap = new Map<string, any[]>();
    (segmentsRes.data || []).forEach((seg: any) => {
      const list = segmentsMap.get(seg.meeting_id) || [];
      list.push(seg);
      segmentsMap.set(seg.meeting_id, list);
    });

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
    const expectedUserUuid = userId
      ? ensureValidUuid(userId)
      : userEmail
      ? ensureValidUuid(`marcameet_user:${userEmail.trim().toLowerCase()}`)
      : undefined;

    for (const row of meetingRows) {
      if (row.details_json && typeof row.details_json === 'object' && row.details_json.meeting) {
        const d = row.details_json as CompleteMeetingDetails;
        reconstructed.push(d);
        continue;
      }

      const tRow = transcriptsMap.get(row.id);
      const segRows = segmentsMap.get(row.id) || [];
      const sRow = summariesMap.get(row.id);
      const dRows = decisionsMap.get(row.id) || [];
      const tkRows = tasksMap.get(row.id) || [];

      const rawSpeakerMap = { ...(tRow?.speaker_map || {}) };
      const accountMeta = rawSpeakerMap.__account_meta || {};
      const fullBackup = rawSpeakerMap.__full_backup || {};
      delete rawSpeakerMap.__account_meta;
      delete rawSpeakerMap.__full_backup;

      const resolvedUserId = row.user_id || accountMeta.user_id || expectedUserUuid || 'u-001';
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
              speaker_map: Object.keys(rawSpeakerMap).length > 0 ? rawSpeakerMap : { 'Participante 1': 'Participante 1' },
              segments:
                segRows.length > 0
                  ? segRows.map((s: any) => ({
                      id: s.id,
                      transcript_id: s.transcript_id,
                      meeting_id: row.id,
                      start_time: Number(s.start_time || 0),
                      end_time: Number(s.end_time || 0),
                      speaker: s.speaker || 'Participante 1',
                      text: s.text || '',
                      confidence: s.confidence ? Number(s.confidence) : undefined,
                    }))
                  : fullBackup.segments || [],
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
        tasks: (fullBackup.tasks || tkRows).map((t: any) => ({
          ...t,
          user_id: resolvedUserId,
          meeting_title: row.title || 'Reunião Salva',
        })),
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

    if (expectedUserUuid || userEmail) {
      const normalizedEmail = userEmail?.trim().toLowerCase();
      return reconstructed.filter((item) => {
        const mUserId = item.meeting.user_id;
        const mEmail = item.meeting.user_email?.trim().toLowerCase();
        const isUnowned = !mUserId || mUserId === 'u-001' || mUserId === 'anonymous';
        const matchesId = expectedUserUuid && (mUserId === expectedUserUuid || ensureValidUuid(mUserId) === expectedUserUuid);
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
    const userUuid = session.user_id && session.user_id !== 'u-001' ? ensureValidUuid(session.user_id) : null;
    const { error } = await client.from('active_meetings').upsert({
      meeting_id: session.meeting_id,
      user_id: userUuid,
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
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra um bloco de áudio no Supabase rejeitando duplicidades
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

    return !error;
  } catch {
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
  } catch {
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
  } catch {
    return false;
  }
}

/**
 * Salva o áudio da reunião no Supabase (como DataURL na tabela transcripts para funcionar sem precisar criar bucket separado)
 */
export async function saveAudioBlobToSupabase(meetingId: string, blob: Blob): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !blob || blob.size === 0 || blob.size > 6 * 1024 * 1024) return false;

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const meetingUuid = ensureValidUuid(meetingId);
    const audioRowId = ensureValidUuid(`audio-file:${meetingUuid}`);

    const { error } = await client.from('transcripts').upsert({
      id: audioRowId,
      meeting_id: meetingUuid,
      raw_text: dataUrl,
      speaker_map: {
        __is_audio_storage: true,
        mime_type: blob.type || 'audio/webm',
        size_bytes: blob.size,
      },
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Busca o áudio da reunião salvo no Supabase (retorna DataURL ou null)
 */
export async function fetchAudioDataUrlFromSupabase(meetingId: string): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client || !meetingId) return null;

  try {
    const meetingUuid = ensureValidUuid(meetingId);
    const audioRowId = ensureValidUuid(`audio-file:${meetingUuid}`);

    const { data, error } = await client
      .from('transcripts')
      .select('raw_text')
      .eq('id', audioRowId)
      .limit(1);

    if (!error && data && data.length > 0 && data[0].raw_text?.startsWith('data:audio')) {
      return data[0].raw_text;
    }
  } catch {}
  return null;
}
