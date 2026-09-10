export interface SegmentResult {
  start_time: number;
  end_time: number;
  speaker: string;
  text: string;
  confidence?: number;
}

export interface TranscriptionResponse {
  raw_text: string;
  segments: SegmentResult[];
  speaker_map: Record<string, string>;
}

export interface ExtractionResponse {
  objective: string;
  key_topics: string[];
  conclusions: string;
  final_status: string;
  highlights: Array<{ description: string; timestamp_start?: number; original_snippet?: string }>;
  decisions: Array<{ decision_text: string; timestamp_start?: number; original_snippet?: string }>;
  tasks: Array<{
    title: string;
    description?: string;
    assignee: string;
    due_date_text: string;
    priority: 'Baixa' | 'Média' | 'Alta' | 'Urgente';
    timestamp_start?: number;
    original_snippet?: string;
  }>;
  pending_items: Array<{ item_text: string; timestamp_start?: number }>;
  next_steps_agreed: string[];
  next_steps_ai_suggestions: string[];
  risks: Array<{
    risk_type: 'financeiro' | 'juridico' | 'comercial' | 'atraso' | 'conflito' | 'dependencia' | 'outro';
    description: string;
    is_ai_generated: boolean;
    timestamp_start?: number;
  }>;
  opportunities: Array<{
    category: 'venda' | 'parceria' | 'reducao_custo' | 'expansao' | 'outro';
    description: string;
    timestamp_start?: number;
  }>;
  values: Array<{
    amount_formatted: string;
    numeric_value?: number;
    context: string;
    timestamp_start?: number;
    original_snippet?: string;
  }>;
  dates: Array<{
    original_text: string;
    context: string;
    timestamp_start?: number;
  }>;
  quotes: Array<{
    speaker: string;
    phrase: string;
    timestamp_start?: number;
  }>;
}

export interface TranscriptionProvider {
  transcribe(audioBlobOrBuffer: Blob | Buffer, filename: string): Promise<TranscriptionResponse>;
}

export interface LLMProvider {
  analyzeMeeting(transcriptText: string, segments?: SegmentResult[]): Promise<ExtractionResponse>;
}

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}
