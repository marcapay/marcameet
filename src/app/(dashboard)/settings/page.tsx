"use client";

import { useState, useEffect, useRef } from "react";
import {
  Settings,
  Database,
  Check,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  Copy,
  KeyRound,
  AlertTriangle,
  UserCheck,
  UserPlus,
  LogIn,
  LogOut,
  Mail,
  Lock,
  User,
  Building2,
  Download,
  Upload,
  Video,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { getStoredKey, setStoredKey } from "@/lib/storage/keysStorage";
import {
  getCurrentAccount,
  subscribeAccountChange,
  registerAccount,
  loginAccount,
  resetAccountPassword,
  logoutAccount,
  listKnownDeviceAccounts,
} from "@/lib/auth/accountSystem";
import {
  getLocalMeetings,
  subscribeLocalMeetings,
  syncAccountMeetingsNow,
  exportMeetingsBackupJson,
  importMeetingsBackupJson,
} from "@/lib/storage/mockStorage";
import { CompleteMeetingDetails, UserAccount } from "@/types/database";

const SQL_SCRIPT = `-- SCRIPT SQL PARA O SUPABASE: CONTAS DE USUÁRIO, TABELA MARCAMEET E TRANSCRIÇÕES
-- Cole este código no SQL Editor do seu Dashboard no Supabase (https://supabase.com)

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
CREATE POLICY "Permitir acesso completo tarefas" ON public.meeting_tasks FOR ALL USING (true);`;

export default function SettingsPage() {
  // Estados da Conta de Usuário
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [meetings, setMeetings] = useState<CompleteMeetingDetails[]>([]);
  const [knownAccounts, setKnownAccounts] = useState<UserAccount[]>([]);
  const [authTab, setAuthTab] = useState<"register" | "login" | "reset">("register");
  const [accName, setAccName] = useState("");
  const [accEmail, setAccEmail] = useState("");
  const [accCompany, setAccCompany] = useState("");
  const [accPassword, setAccPassword] = useState("");
  const [accConfirmPassword, setAccConfirmPassword] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isSyncingMeetings, setIsSyncingMeetings] = useState(false);
  const [accountFeedback, setAccountFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  // Estados das Chaves de API e Supabase
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

  useEffect(() => {
    setSupabaseUrl(getStoredKey("supa_url", process.env.NEXT_PUBLIC_SUPABASE_URL || ""));
    setSupabaseAnonKey(getStoredKey("supa_anon_key", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""));

    setOpenaiKey(getStoredKey("ai_openai_key"));
    setGeminiKey(getStoredKey("ai_gemini_key"));
    setGroqKey(getStoredKey("ai_groq_key"));

    const currentAcc = getCurrentAccount();
    setAccount(currentAcc);
    setMeetings(getLocalMeetings());

    listKnownDeviceAccounts().then((list) => {
      setKnownAccounts(list);
      if (list.length > 0 && !currentAcc) {
        setAuthTab("login");
      }
    });

    const unsubAcc = subscribeAccountChange((acc) => {
      setAccount(acc);
      setMeetings(getLocalMeetings());
      listKnownDeviceAccounts().then(setKnownAccounts);
    });

    const unsubMeetings = subscribeLocalMeetings((list) => {
      setMeetings(list);
    });

    return () => {
      unsubAcc();
      unsubMeetings();
    };
  }, []);

  const showAccountMsg = (type: "success" | "error", text: string) => {
    setAccountFeedback({ type, text });
    if (type === "success") {
      setTimeout(() => setAccountFeedback(null), 5000);
    }
  };

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountFeedback(null);

    if (authTab === "register" || authTab === "reset") {
      if (accPassword !== accConfirmPassword) {
        showAccountMsg("error", "As senhas digitadas não coincidem.");
        return;
      }
    }

    setIsAuthSubmitting(true);
    try {
      if (authTab === "register") {
        const res = await registerAccount({
          name: accName,
          email: accEmail,
          password: accPassword,
          company: accCompany,
        });
        if (!res.success) {
          showAccountMsg("error", res.error || "Não foi possível criar a conta.");
        } else {
          await syncAccountMeetingsNow();
          showAccountMsg("success", "Conta criada e conectada! Todas as suas reuniões estão salvas e protegidas.");
          setAccPassword("");
          setAccConfirmPassword("");
        }
      } else if (authTab === "login") {
        const res = await loginAccount({
          email: accEmail,
          password: accPassword,
        });
        if (!res.success) {
          showAccountMsg("error", res.error || "E-mail ou senha incorretos.");
        } else {
          await syncAccountMeetingsNow();
          showAccountMsg("success", `Login realizado! Bem-vindo(a), ${res.account?.name}. Reuniões sincronizadas.`);
          setAccPassword("");
        }
      } else {
        const res = await resetAccountPassword({
          email: accEmail,
          newPassword: accPassword,
        });
        if (!res.success) {
          showAccountMsg("error", res.error || "Erro ao redefinir senha.");
        } else {
          await syncAccountMeetingsNow();
          showAccountMsg("success", "Senha redefinida com sucesso! Você já está conectado(a).");
          setAccPassword("");
          setAccConfirmPassword("");
        }
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleSyncAccountNow = async () => {
    setIsSyncingMeetings(true);
    try {
      const res = await syncAccountMeetingsNow();
      showAccountMsg(
        "success",
        `Sincronização concluída! ${res.totalSaved} reunião(ões) salvas permanentemente na sua conta.`
      );
    } finally {
      setIsSyncingMeetings(false);
    }
  };

  const handleDownloadBackup = () => {
    try {
      const json = exportMeetingsBackupJson();
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      const emailSlug = account?.email ? account.email.split("@")[0] : "conta";
      a.href = url;
      a.download = `marcameet-backup-${emailSlug}-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showAccountMsg("success", "Backup (.json) de todas as suas reuniões baixado com sucesso!");
    } catch {
      showAccountMsg("error", "Erro ao gerar arquivo de backup.");
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importMeetingsBackupJson(text);
      showAccountMsg(
        "success",
        `${res.importedCount} reunião(ões) restaurada(s) com sucesso! Total na conta: ${res.totalCount}.`
      );
    } catch (err: any) {
      showAccountMsg("error", err?.message || "Arquivo de backup inválido.");
    } finally {
      if (backupFileInputRef.current) backupFileInputRef.current.value = "";
    }
  };

  const handleLogout = async () => {
    await logoutAccount();
    showAccountMsg("success", "Você saiu da conta. Suas reuniões continuam salvas para quando entrar novamente.");
  };

  const getInitials = (fullName: string) =>
    fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");

  const handleCopySql = () => {
    navigator.clipboard.writeText(SQL_SCRIPT);
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
      const { error } = await tempClient.from("marcameet").select("count", { count: "exact", head: true });

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

    syncAccountMeetingsNow().catch(() => {});

    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 3000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-400" />
          <span>Configurações, Conta & Chaves de API</span>
        </h1>
        <p className="text-xs text-slate-400">
          Gerencie sua conta para salvar suas reuniões permanentemente e configure suas chaves de Inteligência Artificial.
        </p>
      </div>

      {/* ===================================================================== */}
      {/* SEÇÃO 1: SISTEMA DE CONTAS & SALVAMENTO PERMANENTE DE REUNIÕES        */}
      {/* ===================================================================== */}
      <div className="p-6 rounded-3xl glass-card border border-indigo-500/40 space-y-5 shadow-xl relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-bold text-white">Minha Conta & Salvamento de Reuniões</h2>
          </div>
          {account ? (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              CONTA CONECTADA ({meetings.length} REUNIÕES SALVAS)
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
              CRIE SUA CONTA OU ENTRE ABAIXO
            </span>
          )}
        </div>

        {accountFeedback && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 ${
              accountFeedback.type === "success"
                ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-200"
                : "bg-rose-500/20 border border-rose-500/40 text-rose-200"
            }`}
          >
            {accountFeedback.type === "success" ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{accountFeedback.text}</span>
          </div>
        )}

        {!account ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-300">
              Crie uma conta ou faça login para que todas as suas reuniões ({meetings.length} no momento) fiquem vinculadas à sua conta e nunca se percam.
            </p>

            {/* Abas Criar Conta / Entrar / Redefinir Senha */}
            <div className="grid grid-cols-3 gap-2 p-1 rounded-2xl bg-slate-900 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthTab("register");
                  setAccountFeedback(null);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
                  authTab === "register"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Criar Conta</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthTab("login");
                  setAccountFeedback(null);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
                  authTab === "login"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Entrar</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthTab("reset");
                  setAccountFeedback(null);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
                  authTab === "reset"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Redefinir Senha</span>
              </button>
            </div>

            <form onSubmit={handleAccountSubmit} className="space-y-3">
              {authTab === "register" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Seu Nome *</label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                      <input
                        type="text"
                        required
                        value={accName}
                        onChange={(e) => setAccName(e.target.value)}
                        placeholder="Ex: Marcelo Silva"
                        className="w-full pl-10 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Empresa (Opcional)</label>
                    <div className="relative">
                      <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                      <input
                        type="text"
                        value={accCompany}
                        onChange={(e) => setAccCompany(e.target.value)}
                        placeholder="Ex: MarcaPay"
                        className="w-full pl-10 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">E-mail da Conta *</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                  <input
                    type="email"
                    required
                    value={accEmail}
                    onChange={(e) => setAccEmail(e.target.value)}
                    placeholder="seuemail@empresa.com"
                    className="w-full pl-10 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className={`grid grid-cols-1 ${authTab !== "login" ? "sm:grid-cols-2" : ""} gap-3`}>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {authTab === "reset" ? "Nova Senha *" : "Senha *"}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={accPassword}
                      onChange={(e) => setAccPassword(e.target.value)}
                      placeholder="Mínimo 4 caracteres"
                      className="w-full pl-10 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {authTab !== "login" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Confirmar Senha *</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                      <input
                        type="password"
                        required
                        minLength={4}
                        value={accConfirmPassword}
                        onChange={(e) => setAccConfirmPassword(e.target.value)}
                        placeholder="Repita a senha"
                        className="w-full pl-10 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isAuthSubmitting}
                className="w-full py-3 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-xs shadow-lg shadow-indigo-600/25 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {authTab === "register" ? (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>{isAuthSubmitting ? "CRIANDO CONTA..." : "CRIAR CONTA E SALVAR MINHAS REUNIÕES"}</span>
                  </>
                ) : authTab === "login" ? (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>{isAuthSubmitting ? "ENTRANDO..." : "ENTRAR NA MINHA CONTA"}</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>{isAuthSubmitting ? "ATUALIZANDO..." : "REDEFINIR SENHA E ENTRAR"}</span>
                  </>
                )}
              </button>
            </form>

            {knownAccounts.length > 0 && authTab === "login" && (
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <p className="text-[11px] font-bold text-slate-400">Contas salvas neste aparelho:</p>
                <div className="flex flex-wrap gap-2">
                  {knownAccounts.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => setAccEmail(acc.email)}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 flex items-center gap-2 transition-all"
                    >
                      <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                      <span className="font-bold">{acc.name}</span>
                      <span className="text-slate-400">({acc.email})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-emerald-500 flex items-center justify-center text-base font-black text-white shadow-md">
                  {getInitials(account.name)}
                </div>
                <div>
                  <p className="text-sm font-extrabold text-white">{account.name}</p>
                  <p className="text-xs text-slate-300">{account.email}</p>
                  <p className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                    <Video className="w-3 h-3" />
                    <span>{meetings.length} reunião(ões) salvas permanentemente nesta conta</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-800 hover:border-rose-500/40 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair da Conta</span>
              </button>
            </div>

            {/* Botões de Sincronização e Backup das Reuniões */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleSyncAccountNow}
                disabled={isSyncingMeetings}
                className="py-2 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingMeetings ? "animate-spin" : ""}`} />
                <span>{isSyncingMeetings ? "SINCRONIZANDO..." : "SINCRONIZAR REUNIÕES"}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadBackup}
                className="py-2 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>BAIXAR BACKUP (.JSON)</span>
              </button>

              <button
                type="button"
                onClick={() => backupFileInputRef.current?.click()}
                className="py-2 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <Upload className="w-3.5 h-3.5 text-indigo-400" />
                <span>RESTAURAR BACKUP (.JSON)</span>
              </button>

              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </div>
          </div>
        )}
      </div>

      {/* Notificações das Chaves de API */}
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
