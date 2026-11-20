export type MeetingSourceType = 'recording' | 'audio_upload' | 'video_upload' | 'pasted_text' | 'online_meeting';

export type MeetingStatus = 
  | 'CRIADA' 
  | 'ENVIANDO' 
  | 'ARQUIVO_RECEBIDO' 
  | 'TRANSCREVENDO' 
  | 'ANALISANDO' 
  | 'GERANDO_RESULTADO' 
  | 'CONCLUIDA' 
  | 'ERRO';

export type TaskStatus = 'Pendente' | 'Em andamento' | 'Concluída' | 'Cancelada';
export type TaskPriority = 'Baixa' | 'Média' | 'Alta' | 'Urgente';

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  company?: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  company?: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
  last_login_at: string;
}

export interface Meeting {
  id: string;
  user_id: string;
  user_email?: string;
  title: string;
  description: string | null;
  meeting_date: string;
  duration_seconds: number;
  source_type: MeetingSourceType;
  status: MeetingStatus;
  error_message: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;

  // Virtual / Count fields for UI
  tasks_count?: number;
  decisions_count?: number;
  highlights_count?: number;
}

export interface TranscriptSegment {
  id: string;
  transcript_id: string;
  meeting_id: string;
  start_time: number;
  end_time: number;
  speaker: string;
  text: string;
  confidence?: number;
}

export interface Transcript {
  id: string;
  meeting_id: string;
  raw_text: string;
  speaker_map: Record<string, string>; // e.g. {"Pessoa 1": "Marcelo"}
  segments?: TranscriptSegment[];
}

export interface MeetingSummary {
  id: string;
  meeting_id: string;
  objective: string;
  key_topics: string[];
  conclusions: string;
  final_status: string;
}

export interface MeetingHighlight {
  id: string;
  meeting_id: string;
  description: string;
  timestamp_start?: number;
  original_snippet?: string;
}

export interface MeetingDecision {
  id: string;
  meeting_id: string;
  decision_text: string;
  timestamp_start?: number;
  original_snippet?: string;
}

export interface MeetingTask {
  id: string;
  meeting_id: string;
  user_id: string;
  title: string;
  description?: string;
  assignee: string;
  due_date?: string;
  original_due_date_text?: string;
  priority: TaskPriority;
  status: TaskStatus;
  timestamp_start?: number;
  original_snippet?: string;
  created_at: string;
  meeting_title?: string;
}

export interface MeetingPendingItem {
  id: string;
  meeting_id: string;
  item_text: string;
  timestamp_start?: number;
}

export interface MeetingRisk {
  id: string;
  meeting_id: string;
  risk_type: 'financeiro' | 'juridico' | 'comercial' | 'atraso' | 'conflito' | 'dependencia' | 'outro';
  description: string;
  is_ai_generated: boolean;
  timestamp_start?: number;
}

export interface MeetingOpportunity {
  id: string;
  meeting_id: string;
  category: 'venda' | 'parceria' | 'reducao_custo' | 'expansao' | 'outro';
  description: string;
  timestamp_start?: number;
}

export interface MeetingValue {
  id: string;
  meeting_id: string;
  amount_formatted: string;
  numeric_value?: number;
  context?: string;
  timestamp_start?: number;
  original_snippet?: string;
}

export interface MeetingDate {
  id: string;
  meeting_id: string;
  extracted_date?: string;
  original_text: string;
  context?: string;
  timestamp_start?: number;
}

export interface MeetingQuote {
  id: string;
  meeting_id: string;
  speaker: string;
  phrase: string;
  timestamp_start?: number;
}

export type MeetingBoardKey = "decisions" | "highlights" | "tasks" | "pending_items" | "risks" | "opportunities";

export interface MeetingMaterial {
  board?: MeetingBoardKey;
  name: string;
  text: string;
}

export interface CompleteMeetingDetails {
  support_materials?: MeetingMaterial[];
  meeting: Meeting;
  transcript?: Transcript;
  summary?: MeetingSummary;
  highlights: MeetingHighlight[];
  decisions: MeetingDecision[];
  tasks: MeetingTask[];
  pending_items: MeetingPendingItem[];
  risks: MeetingRisk[];
  opportunities: MeetingOpportunity[];
  values: MeetingValue[];
  dates: MeetingDate[];
  quotes: MeetingQuote[];
  next_steps_agreed: string[];
  next_steps_ai_suggestions: string[];
}

export type ActiveMeetingEngineStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'background'
  | 'reconnecting'
  | 'interrupted'
  | 'finishing'
  | 'finished'
  | 'error';

export type AudioSourceStatus = 'active' | 'ended' | 'interrupted' | 'muted';
export type MediaRecorderStatus = 'inactive' | 'recording' | 'paused';

export type VisualRecordingState =
  | 'idle'
  | 'recording'    // 🔴 Gravando
  | 'paused'       // ⏸️ Pausado
  | 'interrupted'  // ⚠️ Captura interrompida
  | 'syncing'      // ☁️ Sincronizando áudio
  | 'saved';       // ✅ Gravação salva

export interface InterruptionGap {
  id: string;
  started_at: string;
  started_at_ms: number;
  ended_at?: string;
  ended_at_ms?: number;
  duration_seconds?: number;
  reason: 'track_muted' | 'track_ended' | 'os_suspended' | 'recorder_error' | 'page_reloaded';
  message: string;
}

export interface ActiveMeetingSessionState {
  participants?: string;
  meeting_id: string;
  session_id: string;
  user_id?: string;
  title: string;
  source_type: MeetingSourceType;
  status: ActiveMeetingEngineStatus;
  started_at: string; // ISO string or timestamp
  started_at_ms: number;
  last_chunk_at: string;
  last_chunk_at_ms?: number;
  last_activity_at: string;
  ended_at?: string | null;
  source_status: AudioSourceStatus;
  recorder_status: MediaRecorderStatus;
  accumulated_paused_ms: number;
  paused_at_ms?: number;
  auto_paused_reason?: 'screen_off' | 'mic_mute' | 'os_suspended' | 'user' | null;
  wake_lock_enabled: boolean;
  transcript_draft?: string;
  speaker_map?: Record<string, string>;
  segments_draft?: TranscriptSegment[];
  interruption_gaps?: InterruptionGap[];
  total_chunks_saved?: number;
  synced_chunks_count?: number;
  pending_sync_chunks?: number;
  is_syncing_audio?: boolean;
  last_synced_at?: string;
}

export interface AudioChunkMetadata {
  id: string; // meeting_id + '_' + session_id + '_' + sequence_number
  meeting_id: string;
  session_id: string;
  sequence_number: number;
  timestamp_start: number;
  duration_seconds: number;
  blob?: Blob;
  status: 'pending_local' | 'uploading' | 'uploaded' | 'error';
  created_at: string;
}

