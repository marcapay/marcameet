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
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: string;
  user_id: string;
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

export interface CompleteMeetingDetails {
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

export type AudioSourceStatus = 'active' | 'ended' | 'interrupted';
export type MediaRecorderStatus = 'inactive' | 'recording' | 'paused';

export interface ActiveMeetingSessionState {
  meeting_id: string;
  session_id: string;
  user_id?: string;
  title: string;
  source_type: MeetingSourceType;
  status: ActiveMeetingEngineStatus;
  started_at: string; // ISO string or timestamp
  started_at_ms: number;
  last_chunk_at: string;
  last_activity_at: string;
  ended_at?: string | null;
  source_status: AudioSourceStatus;
  recorder_status: MediaRecorderStatus;
  accumulated_paused_ms: number;
  paused_at_ms?: number;
  auto_paused_reason?: 'screen_off' | 'mic_mute' | 'user' | null;
  wake_lock_enabled: boolean;
  transcript_draft?: string;
  speaker_map?: Record<string, string>;
  segments_draft?: TranscriptSegment[];
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

