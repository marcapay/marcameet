-- Habilitar a extensão pgvector para busca semântica
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Tabela PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela MEETINGS
CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  meeting_date TIMESTAMPTZ DEFAULT NOW(),
  duration_seconds INT DEFAULT 0,
  source_type TEXT NOT NULL CHECK (source_type IN ('recording', 'audio_upload', 'video_upload', 'pasted_text')),
  status TEXT NOT NULL DEFAULT 'CRIADA' CHECK (status IN ('CRIADA', 'ENVIANDO', 'ARQUIVO_RECEBIDO', 'TRANSCREVENDO', 'ANALISANDO', 'GERANDO_RESULTADO', 'CONCLUIDA', 'ERRO')),
  error_message TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela MEETING_FILES
CREATE TABLE IF NOT EXISTS public.meeting_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  original_filename TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela TRANSCRIPTS
CREATE TABLE IF NOT EXISTS public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  speaker_map JSONB DEFAULT '{}'::jsonb, -- Mapeamento ex: {"Pessoa 1": "Marcelo"}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabela TRANSCRIPT_SEGMENTS
CREATE TABLE IF NOT EXISTS public.transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES public.transcripts(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  start_time NUMERIC(10, 2) NOT NULL,
  end_time NUMERIC(10, 2) NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence NUMERIC(4, 3),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabela MEETING_SUMMARIES
CREATE TABLE IF NOT EXISTS public.meeting_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  objective TEXT,
  key_topics JSONB DEFAULT '[]'::jsonb,
  conclusions TEXT,
  final_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Tabela MEETING_HIGHLIGHTS
CREATE TABLE IF NOT EXISTS public.meeting_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  timestamp_start NUMERIC(10, 2),
  original_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Tabela MEETING_DECISIONS
CREATE TABLE IF NOT EXISTS public.meeting_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  decision_text TEXT NOT NULL,
  timestamp_start NUMERIC(10, 2),
  original_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Tabela MEETING_TASKS
CREATE TABLE IF NOT EXISTS public.meeting_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT DEFAULT 'Responsável não definido',
  due_date TIMESTAMPTZ,
  original_due_date_text TEXT,
  priority TEXT DEFAULT 'Média' CHECK (priority IN ('Baixa', 'Média', 'Alta', 'Urgente')),
  status TEXT DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Em andamento', 'Concluída', 'Cancelada')),
  timestamp_start NUMERIC(10, 2),
  original_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Tabela MEETING_PENDING_ITEMS
CREATE TABLE IF NOT EXISTS public.meeting_pending_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  item_text TEXT NOT NULL,
  timestamp_start NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Tabela MEETING_RISKS
CREATE TABLE IF NOT EXISTS public.meeting_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  risk_type TEXT DEFAULT 'outro',
  description TEXT NOT NULL,
  is_ai_generated BOOLEAN DEFAULT FALSE,
  timestamp_start NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Tabela MEETING_OPPORTUNITIES
CREATE TABLE IF NOT EXISTS public.meeting_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  category TEXT DEFAULT 'outro',
  description TEXT NOT NULL,
  timestamp_start NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Tabela MEETING_VALUES
CREATE TABLE IF NOT EXISTS public.meeting_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  amount_formatted TEXT NOT NULL,
  numeric_value NUMERIC(15, 2),
  context TEXT,
  timestamp_start NUMERIC(10, 2),
  original_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Tabela MEETING_DATES
CREATE TABLE IF NOT EXISTS public.meeting_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  extracted_date TIMESTAMPTZ,
  original_text TEXT NOT NULL,
  context TEXT,
  timestamp_start NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Tabela MEETING_QUOTES
CREATE TABLE IF NOT EXISTS public.meeting_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,
  phrase TEXT NOT NULL,
  timestamp_start NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Tabela MEETING_EMBEDDINGS (Memória Semântica com PGVector)
CREATE TABLE IF NOT EXISTS public.meeting_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('transcript_segment', 'summary', 'decision', 'task', 'risk', 'opportunity', 'value')),
  content_text TEXT NOT NULL,
  embedding VECTOR(1536), -- Compatível com OpenAI text-embedding-3-small
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ÍNDICES PARA ALTA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_meetings_user ON public.meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON public.meetings(status);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting ON public.transcript_segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON public.meeting_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON public.meeting_embeddings USING hnsw (embedding vector_cosine_ops);

-- SEGURANÇA: ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_pending_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_embeddings ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS RLS (Isolamento de dados por usuário auth.uid())
CREATE POLICY "Usuário acessa próprio perfil" ON public.profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Usuário acessa próprias reuniões" ON public.meetings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Usuário acessa próprios arquivos" ON public.meeting_files FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_files.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa próprias transcrições" ON public.transcripts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = transcripts.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa próprios segmentos" ON public.transcript_segments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = transcript_segments.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa resumos" ON public.meeting_summaries FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_summaries.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa tarefas" ON public.meeting_tasks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Usuário acessa decisões" ON public.meeting_decisions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_decisions.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa pontos importantes" ON public.meeting_highlights FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_highlights.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa pendencias" ON public.meeting_pending_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_pending_items.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa riscos" ON public.meeting_risks FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_risks.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa oportunidades" ON public.meeting_opportunities FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_opportunities.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa valores" ON public.meeting_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_values.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa datas" ON public.meeting_dates FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_dates.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa frases" ON public.meeting_quotes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.meetings WHERE id = meeting_quotes.meeting_id AND user_id = auth.uid())
);
CREATE POLICY "Usuário acessa embeddings" ON public.meeting_embeddings FOR ALL USING (auth.uid() = user_id);
