-- ==============================================================================
-- ESTRUTURA PARA GRAVAÇÃO PERSISTENTE E GERENCIAMENTO DE CHUNKS DE ÁUDIO
-- ==============================================================================

-- 1. Tabela de Reuniões Ativas (ACTIVE_MEETINGS)
CREATE TABLE IF NOT EXISTS public.active_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id TEXT NOT NULL UNIQUE,
  user_id UUID,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'recording',
  status TEXT NOT NULL DEFAULT 'recording' CHECK (
    status IN ('idle', 'starting', 'recording', 'background', 'reconnecting', 'interrupted', 'finishing', 'finished', 'error')
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_chunk_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  source_status TEXT NOT NULL DEFAULT 'active' CHECK (source_status IN ('active', 'ended', 'interrupted')),
  recorder_status TEXT NOT NULL DEFAULT 'recording' CHECK (recorder_status IN ('inactive', 'recording', 'paused')),
  accumulated_paused_ms INT DEFAULT 0,
  wake_lock_enabled BOOLEAN DEFAULT TRUE,
  transcript_draft TEXT DEFAULT '',
  speaker_map JSONB DEFAULT '{}'::jsonb,
  segments_draft JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Blocos de Áudio com Deduplicação (AUDIO_CHUNKS)
CREATE TABLE IF NOT EXISTS public.audio_chunks (
  id TEXT PRIMARY KEY, -- Formato: meeting_id + '_' + session_id + '_' + sequence_number
  meeting_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence_number INT NOT NULL,
  timestamp_start NUMERIC(10, 2) NOT NULL,
  duration_seconds NUMERIC(6, 2) DEFAULT 8.0,
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_chunk_identity UNIQUE (meeting_id, session_id, sequence_number)
);

-- ÍNDICES PARA BUSCA RÁPIDA E SINCRONIZAÇÃO
CREATE INDEX IF NOT EXISTS idx_active_meetings_status ON public.active_meetings(status);
CREATE INDEX IF NOT EXISTS idx_active_meetings_user ON public.active_meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_audio_chunks_meeting ON public.audio_chunks(meeting_id, sequence_number);

-- RLS (ROW LEVEL SECURITY)
ALTER TABLE public.active_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir acesso reuniões ativas" ON public.active_meetings FOR ALL USING (true);
CREATE POLICY "Permitir acesso blocos de audio" ON public.audio_chunks FOR ALL USING (true);
