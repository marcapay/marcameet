-- ==============================================================================
-- SCRIPT SQL PARA O SUPABASE: CONTAS DE USUÁRIO, TABELA MARCAMEET E TRANSCRIÇÕES
-- Cole este código no SQL Editor do seu Dashboard no Supabase (https://supabase.com)
-- ==============================================================================

-- 0. Tabela de Contas de Usuário (MARCAMEET_USERS)
CREATE TABLE IF NOT EXISTS public.marcameet_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1. Tabela Principal de Reuniões (MARCAMEET)
CREATE TABLE IF NOT EXISTS public.marcameet (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  title TEXT NOT NULL,
  description TEXT,
  meeting_date TIMESTAMPTZ DEFAULT NOW(),
  duration_seconds INT DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'recording',
  status TEXT NOT NULL DEFAULT 'CONCLUIDA',
  error_message TEXT,
  tags TEXT[] DEFAULT '{}',
  details_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir colunas caso a tabela já tenha sido criada anteriormente
ALTER TABLE public.marcameet ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.marcameet ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE public.marcameet ADD COLUMN IF NOT EXISTS details_json JSONB;

-- 2. Tabela de Transcrição Completa (TRANSCRIPTS)
CREATE TABLE IF NOT EXISTS public.transcripts (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  speaker_map JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de Trechos e Linha do Tempo por Falante (TRANSCRIPT_SEGMENTS)
CREATE TABLE IF NOT EXISTS public.transcript_segments (
  id TEXT PRIMARY KEY,
  transcript_id TEXT REFERENCES public.transcripts(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  start_time NUMERIC(10, 2) NOT NULL,
  end_time NUMERIC(10, 2) NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence NUMERIC(4, 3),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Resumos Executivos (MEETING_SUMMARIES)
CREATE TABLE IF NOT EXISTS public.meeting_summaries (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  objective TEXT,
  key_topics JSONB DEFAULT '[]'::jsonb,
  conclusions TEXT,
  final_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabela de Decisões Tomadas (MEETING_DECISIONS)
CREATE TABLE IF NOT EXISTS public.meeting_decisions (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  decision_text TEXT NOT NULL,
  timestamp_start NUMERIC(10, 2),
  original_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabela de Tarefas Mapeadas (MEETING_TASKS)
CREATE TABLE IF NOT EXISTS public.meeting_tasks (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT DEFAULT 'Responsável não definido',
  due_date TIMESTAMPTZ,
  original_due_date_text TEXT,
  priority TEXT DEFAULT 'Média',
  status TEXT DEFAULT 'Pendente',
  timestamp_start NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ÍNDICES PARA ALTA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_marcameet_users_email ON public.marcameet_users(email);
CREATE INDEX IF NOT EXISTS idx_marcameet_user ON public.marcameet(user_id);
CREATE INDEX IF NOT EXISTS idx_marcameet_email ON public.marcameet(user_email);
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON public.transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting ON public.transcript_segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_summaries_meeting ON public.meeting_summaries(meeting_id);

-- POLÍTICAS DE ACESSO (RLS)
ALTER TABLE public.marcameet_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcameet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir acesso completo usuarios" ON public.marcameet_users;
CREATE POLICY "Permitir acesso completo usuarios" ON public.marcameet_users FOR ALL USING (true);
DROP POLICY IF EXISTS "Permitir acesso completo marcameet" ON public.marcameet;
CREATE POLICY "Permitir acesso completo marcameet" ON public.marcameet FOR ALL USING (true);
DROP POLICY IF EXISTS "Permitir acesso completo transcrições" ON public.transcripts;
CREATE POLICY "Permitir acesso completo transcrições" ON public.transcripts FOR ALL USING (true);
DROP POLICY IF EXISTS "Permitir acesso completo segmentos" ON public.transcript_segments;
CREATE POLICY "Permitir acesso completo segmentos" ON public.transcript_segments FOR ALL USING (true);
DROP POLICY IF EXISTS "Permitir acesso completo resumos" ON public.meeting_summaries;
CREATE POLICY "Permitir acesso completo resumos" ON public.meeting_summaries FOR ALL USING (true);
DROP POLICY IF EXISTS "Permitir acesso completo decisões" ON public.meeting_decisions;
CREATE POLICY "Permitir acesso completo decisões" ON public.meeting_decisions FOR ALL USING (true);
DROP POLICY IF EXISTS "Permitir acesso completo tarefas" ON public.meeting_tasks;
CREATE POLICY "Permitir acesso completo tarefas" ON public.meeting_tasks FOR ALL USING (true);
