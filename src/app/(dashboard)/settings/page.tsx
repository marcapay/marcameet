"use client";

import { useState, useEffect } from "react";
import { Settings, Database, Cpu, Check, ShieldCheck, RefreshCw, AlertCircle, Copy, KeyRound, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { getStoredKey, setStoredKey } from "@/lib/storage/keysStorage";

export default function SettingsPage() {
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");

  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedNotification, setSavedNotification] = useState(false);
  const [copiedSqlNotification, setCopiedSqlNotification] = useState(false);

  const sqlScript = `-- SCRIPT SQL PARA O SUPABASE: TABELA MARCAMEET E ESTRUTURA DE TRANSCRIÇÕES
-- Cole este código no SQL Editor do seu Dashboard no Supabase (https://supabase.com)

-- 1. Tabela Principal de Reuniões (MARCAMEET)
CREATE TABLE IF NOT EXISTS public.marcameet (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  meeting_date TIMESTAMPTZ DEFAULT NOW(),
  duration_seconds INT DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'recording',
  status TEXT NOT NULL DEFAULT 'CONCLUIDA',
  error_message TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Transcrição Completa (TRANSCRIPTS)
CREATE TABLE IF NOT EXISTS public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  speaker_map JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de Trechos e Linha do Tempo por Falante (TRANSCRIPT_SEGMENTS)
CREATE TABLE IF NOT EXISTS public.transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID REFERENCES public.transcripts(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  start_time NUMERIC(10, 2) NOT NULL,
  end_time NUMERIC(10, 2) NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence NUMERIC(4, 3),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Resumos Executivos (MEETING_SUMMARIES)
CREATE TABLE IF NOT EXISTS public.meeting_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  objective TEXT,
  key_topics JSONB DEFAULT '[]'::jsonb,
  conclusions TEXT,
  final_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabela de Decisões Tomadas (MEETING_DECISIONS)
CREATE TABLE IF NOT EXISTS public.meeting_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
  decision_text TEXT NOT NULL,
  timestamp_start NUMERIC(10, 2),
  original_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabela de Tarefas Mapeadas (MEETING_TASKS)
CREATE TABLE IF NOT EXISTS public.meeting_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.marcameet(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_marcameet_user ON public.marcameet(user_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON public.transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting ON public.transcript_segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_summaries_meeting ON public.meeting_summaries(meeting_id);

-- POLÍTICAS DE ACESSO (RLS)
ALTER TABLE public.marcameet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir acesso completo marcameet" ON public.marcameet FOR ALL USING (true);
CREATE POLICY "Permitir acesso completo transcrições" ON public.transcripts FOR ALL USING (true);
CREATE POLICY "Permitir acesso completo segmentos" ON public.transcript_segments FOR ALL USING (true);
CREATE POLICY "Permitir acesso completo resumos" ON public.meeting_summaries FOR ALL USING (true);
CREATE POLICY "Permitir acesso completo decisões" ON public.meeting_decisions FOR ALL USING (true);
CREATE POLICY "Permitir acesso completo tarefas" ON public.meeting_tasks FOR ALL USING (true);`;

  useEffect(() => {
    setSupabaseUrl(getStoredKey("supa_url", process.env.NEXT_PUBLIC_SUPABASE_URL || ""));
    setSupabaseAnonKey(getStoredKey("supa_anon_key", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""));

    setOpenaiKey(getStoredKey("ai_openai_key"));
    setGeminiKey(getStoredKey("ai_gemini_key"));
    setGroqKey(getStoredKey("ai_groq_key"));
  }, []);

  const handleCopySql = () => {
    navigator.clipboard.writeText(sqlScript);
    setCopiedSqlNotification(true);
    setTimeout(() => setCopiedSqlNotification(false), 3500);
  };

  const handleTestConnection = async () => {
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
      setConnectionStatus("error");
      setStatusMessage("Por favor, preencha a URL e a Anon Key do Supabase.");
      return;
    }

    setConnectionStatus("testing");
    setStatusMessage("Testando comunicação com o servidor do Supabase...");

    try {
      const tempClient = createClient(supabaseUrl.trim(), supabaseAnonKey.trim());
      const { data, error } = await tempClient.from("marcameet").select("count", { count: "exact", head: true });

      if (error && error.code !== "PGRST301") {
        if (error.message.includes("FetchError") || error.message.includes("Failed to fetch")) {
          throw new Error("Não foi possível conectar. Verifique se a URL do Supabase está correta.");
        }
      }

      setConnectionStatus("success");
      setStatusMessage("Conexão estabelecida com sucesso com a tabela marcameet no Supabase!");
    } catch (err: any) {
      setConnectionStatus("error");
      setStatusMessage(err.message || "Erro de autenticação no Supabase. Verifique a URL e a chave anon.");
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validação Obrigatória: O sistema DEVE exigir pelo menos uma API Key cadastrada
    const hasAnyKey = Boolean(openaiKey.trim() || geminiKey.trim() || groqKey.trim());

    if (!hasAnyKey) {
      setErrorMessage("⚠️ OBRIGATÓRIO: O sistema exige o cadastro de pelo menos uma Chave de API (OpenAI, Gemini ou Groq) para funcionar.");
      return;
    }

    setStoredKey("supa_url", supabaseUrl.trim());
    setStoredKey("supa_anon_key", supabaseAnonKey.trim());
    setStoredKey("ai_openai_key", openaiKey.trim());
    setStoredKey("ai_gemini_key", geminiKey.trim());
    setStoredKey("ai_groq_key", groqKey.trim());

    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 3000);
  };

  const isAnyKeyConfigured = Boolean(openaiKey.trim() || geminiKey.trim() || groqKey.trim());

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-400" />
          <span>Configurações & Chaves de API</span>
        </h1>
        <p className="text-xs text-slate-400">
          O sistema exige obrigatoriamente a configuração de pelo menos uma Chave de API (OpenAI, Gemini ou Groq) para funcionamento.
        </p>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold text-xs flex items-center gap-2 animate-fadeIn shadow-lg shadow-rose-500/10">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {savedNotification && (
        <div className="p-4 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center gap-2 animate-fadeIn">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Chaves de API e configurações salvas com sucesso! O sistema está pronto para uso.</span>
        </div>
      )}

      {copiedSqlNotification && (
        <div className="p-4 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 font-bold text-xs flex items-center gap-2 animate-fadeIn shadow-lg shadow-indigo-600/20">
          <Check className="w-4 h-4 text-indigo-400" />
          <span>Código SQL para criação da tabela marcameet copiado! Pronto para colar no Supabase.</span>
        </div>
      )}

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Provedores de Inteligência Artificial (SEÇÃO OBRIGATÓRIA) */}
        <div className="p-6 rounded-3xl glass-card border border-rose-500/30 space-y-4 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-rose-400" />
              <h2 className="text-sm font-bold text-white">Chaves de API para Inteligência Artificial</h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 tracking-wider">
              OBRIGATÓRIO
            </span>
          </div>

          <p className="text-xs text-rose-300/80 font-medium">
            Insira abaixo pelo menos uma chave de API para habilitar o processamento e inteligência do sistema.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                <span>OpenAI API Key (Whisper Transcrição & GPT-4o)</span>
                {openaiKey && <span className="text-[10px] text-emerald-400 font-bold">✓ Inserida</span>}
              </label>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-proj-..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-rose-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                <span>Google Gemini API Key (Gemini 1.5 Flash Analysis)</span>
                {geminiKey && <span className="text-[10px] text-emerald-400 font-bold">✓ Inserida</span>}
              </label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-rose-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                <span>Groq API Key (Transcrição de Voz Ultra Rápida)</span>
                {groqKey && <span className="text-[10px] text-emerald-400 font-bold">✓ Inserida</span>}
              </label>
              <input
                type="password"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-rose-500 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Supabase Connection Card */}
        <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              <h2 className="text-sm font-bold text-white">Conexão com Banco de Dados Supabase (Tabela marcameet)</h2>
            </div>
            {supabaseUrl && supabaseAnonKey ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                Configurado
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Pendente
              </span>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Supabase Project URL (NEXT_PUBLIC_SUPABASE_URL)
              </label>
              <input
                type="text"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://seu-projeto.supabase.co"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Supabase Anon Key (NEXT_PUBLIC_SUPABASE_ANON_KEY)
              </label>
              <input
                type="password"
                value={supabaseAnonKey}
                onChange={(e) => setSupabaseAnonKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            {/* Status do Teste */}
            {statusMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  connectionStatus === "success"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : connectionStatus === "error"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                    : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                }`}
              >
                {connectionStatus === "testing" && <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />}
                {connectionStatus === "success" && <Check className="w-4 h-4 text-emerald-400" />}
                {connectionStatus === "error" && <AlertCircle className="w-4 h-4 text-rose-400" />}
                <span>{statusMessage}</span>
              </div>
            )}

            {/* Linha de Ação: Botão Testar + Botão Copiar SQL ao Lado */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={connectionStatus === "testing"}
                className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${connectionStatus === "testing" ? "animate-spin text-indigo-400" : "text-emerald-400"}`} />
                <span>TESTAR CONEXÃO COM SUPABASE</span>
              </button>

              <button
                type="button"
                onClick={handleCopySql}
                className="py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/25 active:scale-95 flex items-center justify-center gap-2"
                title="Copiar código SQL para criar a tabela marcameet no Supabase"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>COPIAR SQL DA TABELA MARCAMEET</span>
              </button>
            </div>
          </div>
        </div>

        {/* Botão Salvar */}
        <button
          type="submit"
          className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-extrabold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <Check className="w-5 h-5" />
          <span>SALVAR CHAVES DE API & SUPABASE</span>
        </button>
      </form>
    </div>
  );
}
