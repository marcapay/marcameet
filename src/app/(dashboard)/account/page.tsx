"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  UserCheck,
  UserPlus,
  LogIn,
  LogOut,
  ShieldCheck,
  Mail,
  Lock,
  User,
  Building2,
  RefreshCw,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Video,
  KeyRound,
  Database,
  Check,
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { getStoredKey, setStoredKey } from "@/lib/storage/keysStorage";
import {
  getCurrentAccount,
  hasKnownDeviceAccounts,
  subscribeAccountChange,
  registerAccount,
  loginAccount,
  resetAccountPassword,
  updateAccountProfile,
  logoutAccount,
  syncAccountsAndKeysWithCloud,
} from "@/lib/auth/accountSystem";
import {
  syncAccountMeetingsNow,
  exportMeetingsBackupJson,
  importMeetingsBackupJson,
} from "@/lib/storage/mockStorage";
import { UserAccount } from "@/types/database";

const teamProfiles = [
  { name: "Marcelo Marques", role: "Administrador" },
  { name: "Miguel", role: "Administrador" },
];

export default function AccountPage() {
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [authTab, setAuthTab] = useState<"login" | "register" | "reset">("register");

  const [inviteLink, setInviteLink] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  // Campos de formulário da Conta
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);

  // Edição de perfil
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");

  // Feedback e Sincronização da Conta
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Estados das Chaves de API & Supabase (Integrados na Minha Conta)
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");

  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [savedNotification, setSavedNotification] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStoredKeysState = () => {
    setSupabaseUrl(getStoredKey("supa_url", "https://xuooojiaslhwaejsgjxh.supabase.co"));
    setSupabaseAnonKey(getStoredKey("supa_anon_key", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""));
    setOpenaiKey(getStoredKey("ai_openai_key"));
    setGeminiKey(getStoredKey("ai_gemini_key"));
    setGroqKey(getStoredKey("ai_groq_key"));
  };

  useEffect(() => {
    refreshStoredKeysState();

    const current = getCurrentAccount();
    setAccount(current);
    if (current) {
      setEditName(current.name);
      setEditCompany(current.company || "");
    }
    if (!current) {
      const invited = new URLSearchParams(window.location.search).get("cadastro") === "1";
      if (!invited && hasKnownDeviceAccounts()) setAuthTab("login");
    }

    const unsubAcc = subscribeAccountChange((acc) => {
      setAccount(acc);
      if (acc) {
        setEditName(acc.name);
        setEditCompany(acc.company || "");
      }
      refreshStoredKeysState();
    });

    return unsubAcc;
  }, []);

  const showSuccess = (msg: string) => {
    setErrorMessage(null);
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4500);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage("As senhas digitadas não coincidem.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await registerAccount({
        name,
        email,
        password,
        company,
      });

      if (!res.success) {
        setErrorMessage(res.error || "Não foi possível criar a conta.");
      } else {
        await syncAccountMeetingsNow();
        showSuccess("Conta criada e conectada com sucesso! Todas as suas reuniões agora estão salvas e protegidas.");
        setPassword("");
        setConfirmPassword("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const res = await loginAccount({ email, password });
      if (!res.success) {
        setErrorMessage(res.error || "E-mail ou senha inválidos.");
      } else {
        await syncAccountMeetingsNow();
        showSuccess(`Bem-vindo(a) de volta, ${res.account?.name}! Suas reuniões foram carregadas e sincronizadas.`);
        setPassword("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage("A confirmação de senha não confere.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await resetAccountPassword({
        email,
        newPassword: password,
      });
      if (!res.success) {
        setErrorMessage(res.error || "Não foi possível redefinir a senha.");
      } else {
        await syncAccountMeetingsNow();
        showSuccess("Senha redefinida com sucesso! Você já está conectado(a) na sua conta.");
        setPassword("");
        setConfirmPassword("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await updateAccountProfile({
      name: editName,
      company: editCompany,
    });
    if (updated) {
      setIsEditingProfile(false);
      showSuccess("Dados da conta atualizados com sucesso!");
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await syncAccountMeetingsNow();
      showSuccess(
        res.syncedCloud
          ? `Reuniões sincronizadas: ${res.totalSaved}.`
          : `Reuniões atualizadas: ${res.totalSaved}.`
      );
    } finally {
      setIsSyncing(false);
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
      showSuccess("Arquivo de backup das suas reuniões baixado com sucesso!");
    } catch {
      setErrorMessage("Erro ao gerar arquivo de backup.");
    }
  };

  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const res = await importMeetingsBackupJson(text);
      showSuccess(
        `${res.importedCount} reunião(ões) restaurada(s) com sucesso! Total salvo na conta: ${res.totalCount}.`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || "Arquivo de backup inválido.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleLogout = async () => {
    await logoutAccount();
    showSuccess("Você saiu da conta.");
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
    setApiErrorMessage(null);

    const hasAnyKey = Boolean(openaiKey.trim() || geminiKey.trim() || groqKey.trim());

    if (!hasAnyKey) {
      setApiErrorMessage("⚠️ OBRIGATÓRIO: O sistema exige o cadastro de pelo menos uma Chave de API (OpenAI, Gemini ou Groq) para funcionar.");
      return;
    }

    setStoredKey("supa_url", supabaseUrl.trim());
    setStoredKey("supa_anon_key", supabaseAnonKey.trim());
    setStoredKey("ai_openai_key", openaiKey.trim());
    setStoredKey("ai_gemini_key", geminiKey.trim());
    setStoredKey("ai_groq_key", groqKey.trim());

    syncAccountsAndKeysWithCloud(account).catch(() => {});
    syncAccountMeetingsNow().catch(() => {});

    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 3500);
  };

  const generateInviteLink = () => {
    const url = new URL("/account", window.location.origin);
    url.searchParams.set("cadastro", "1");
    setInviteLink(url.toString());
    setInviteStatus("Link pronto para compartilhar.");
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteStatus("Link copiado.");
    } catch {
      setInviteStatus("Selecione o endereço no campo para copiá-lo.");
    }
  };

  const getInitials = (fullName: string) => {
    return fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn pb-14">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2.5">
            <UserCheck className="w-6 h-6 text-indigo-400" />
            <span>Minha Conta</span>
          </h1>

        </div>

        {account && (
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-800 hover:border-rose-500/40 text-xs font-medium transition-all self-start sm:self-auto"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair da Conta</span>
          </button>
        )}
      </div>

      {/* Alertas da Conta */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-center gap-2.5 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-2.5 shadow-lg">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BLOCO 1: MINHA CONTA & PROTEÇÃO DE REUNIÕES                           */}
      {/* ===================================================================== */}
      {!account ? (
        <div>
          <div className="p-6 sm:p-8 rounded-3xl glass-card border border-indigo-500/30 shadow-sm space-y-6">
            {/* Seletor de Abas */}
            <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthTab("register");
                  setErrorMessage(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  authTab === "register"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
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
                  setErrorMessage(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  authTab === "login"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
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
                  setErrorMessage(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  authTab === "reset"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Redefinir Senha</span>
              </button>
            </div>

            {/* ABA: CRIAR CONTA */}
            {authTab === "register" && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Crie sua conta no Marca Meet</h2>

                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Seu Nome Completo *</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Marcelo Silva"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Seu E-mail *</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seuemail@empresa.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Empresa ou Equipe (Opcional)</label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Ex: MarcaPay"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Criar Senha *</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={4}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Mínimo 4 caracteres"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                        title={showPassword ? "Ocultar senha" : "Ver senha"}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Confirmar Senha *</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        minLength={4}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a senha"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                        title={showConfirmPassword ? "Ocultar senha" : "Ver senha"}
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{isSubmitting ? "CRIANDO CONTA..." : "CRIAR MINHA CONTA E SALVAR REUNIÕES"}</span>
                </button>
              </form>
            )}

            {/* ABA: ENTRAR */}
            {authTab === "login" && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Entrar na sua Conta</h2>
                  <p className="text-xs text-slate-400">
                    Acesse suas reuniões salvas, transcrições, tarefas e resumos executivos.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">E-mail da Conta</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seuemail@empresa.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Senha</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Sua senha"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                      title={showPassword ? "Ocultar senha" : "Ver senha"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{isSubmitting ? "ENTRANDO..." : "ENTRAR E CARREGAR MINHAS REUNIÕES"}</span>
                </button>

              </form>
            )}

            {/* ABA: REDEFINIR SENHA */}
            {authTab === "reset" && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Redefinir Senha da Conta</h2>
                  <p className="text-xs text-slate-400">
                    Informe o e-mail da sua conta e defina uma nova senha de acesso.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">E-mail Cadastrado</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seuemail@empresa.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Nova Senha</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={4}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Nova senha"
                        className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                        title={showPassword ? "Ocultar senha" : "Ver senha"}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Confirmar Nova Senha</label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        minLength={4}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a nova senha"
                        className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                        title={showConfirmPassword ? "Ocultar senha" : "Ver senha"}
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg transition-all active:scale-95"
                >
                  {isSubmitting ? "SALVANDO..." : "ATUALIZAR SENHA E ENTRAR"}
                </button>
              </form>
            )}
          </div>

        </div>
      ) : (
        <div className="space-y-6">
          {/* Card Principal do Usuário */}
          <div className="p-6 rounded-3xl glass-card border border-emerald-500/30 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-500 flex items-center justify-center text-xl font-semibold text-white shadow-lg shadow-indigo-500/20">
                  {getInitials(account.name)}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-white">{account.name}</h2>

                  </div>
                  <p className="text-xs text-slate-300 font-medium mt-0.5">{account.email}</p>
                  {account.company && (
                    <p className="text-[11px] text-indigo-300 font-semibold mt-0.5">{account.company}</p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditingProfile(!isEditingProfile)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 transition-all self-start sm:self-auto"
              >
                {isEditingProfile ? "Cancelar Edição" : "Editar Perfil"}
              </button>
            </div>

            {isEditingProfile && (
              <form onSubmit={handleSaveProfile} className="pt-4 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Nome</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Empresa / Cargo</label>
                  <input
                    type="text"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    placeholder="Opcional"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-all"
                >
                  Salvar Alterações
                </button>
              </form>
            )}
          </div>

          <Link href="/meetings" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-indigo-200">
            <Video className="h-4 w-4" aria-hidden="true" /> Minhas Reuniões
          </Link>

          <details className="rounded-2xl border border-slate-800 px-4">
            <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium text-slate-200">Cópia de segurança</summary>
            <div className="flex flex-wrap items-center gap-3 pb-4">
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
                <span>{isSyncing ? "Sincronizando…" : "Sincronizar reuniões"}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadBackup}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium text-xs transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Baixar cópia</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium text-xs transition-all flex items-center gap-2"
              >
                <Upload className="w-4 h-4 text-indigo-400" />
                <span>Restaurar cópia</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportBackupFile}
                className="hidden"
              />
            </div>
          </details>
        </div>
      )}

      <section className="glass-card rounded-2xl p-5 space-y-3" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-base font-semibold text-white">Convidar usuário</h2>
        <button type="button" onClick={generateInviteLink}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500">
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Gerar link para novo usuário
        </button>
        {inviteLink && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="url" readOnly value={inviteLink} aria-label="Link de cadastro"
              onFocus={(event) => event.target.select()}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" />
            <button type="button" onClick={copyInviteLink}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-indigo-200">
              <Copy className="h-4 w-4" aria-hidden="true" /> Copiar link
            </button>
          </div>
        )}
        {inviteStatus && <p className="text-sm text-slate-300" role="status">{inviteStatus}</p>}
      </section>

      {/* ===================================================================== */}
      {/* BLOCO 2: CHAVES DE API DE INTELIGÊNCIA ARTIFICIAL & SUPABASE          */}
      {/* ===================================================================== */}
      {apiErrorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-medium text-xs flex items-center gap-2 animate-fadeIn shadow-lg shadow-rose-500/10">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{apiErrorMessage}</span>
        </div>
      )}

      {savedNotification && (
        <div className="p-4 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 font-medium text-xs flex items-center gap-2 animate-fadeIn">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Chaves de API e configurações do Supabase salvas com sucesso na sua conta!</span>
        </div>
      )}

      <details className="rounded-2xl border border-slate-800 px-4">
        <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium text-slate-200">Configurações avançadas</summary>
        <form onSubmit={handleSaveSettings} className="space-y-4 pb-4">
          {/* Provedores de Inteligência Artificial */}
          <div className="p-6 rounded-3xl glass-card border border-rose-500/30 space-y-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-rose-400" />
                <h2 className="text-sm font-medium text-white">Chaves de API para Inteligência Artificial</h2>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 tracking-wider">
                OBRIGATÓRIO
              </span>
            </div>

            <p className="text-xs text-rose-300/80 font-medium">
              Insira abaixo pelo menos uma chave de API para habilitar a transcrição e inteligência do sistema.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span>OpenAI API Key (Whisper Transcrição & GPT-4o)</span>
                  {openaiKey && <span className="text-[10px] text-emerald-400 font-medium">✓ Inserida</span>}
                </label>
                <div className="relative">
                  <input
                    type={showApiKeys ? "text" : "password"}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-proj-..."
                    className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-rose-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKeys((v) => !v)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                    title={showApiKeys ? "Ocultar chave" : "Ver chave"}
                  >
                    {showApiKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span>Google Gemini API Key (Gemini 1.5 Flash Analysis)</span>
                  {geminiKey && <span className="text-[10px] text-emerald-400 font-medium">✓ Inserida</span>}
                </label>
                <div className="relative">
                  <input
                    type={showApiKeys ? "text" : "password"}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-rose-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKeys((v) => !v)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                    title={showApiKeys ? "Ocultar chave" : "Ver chave"}
                  >
                    {showApiKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span>Groq API Key (Transcrição de Voz Ultra Rápida)</span>
                  {groqKey && <span className="text-[10px] text-emerald-400 font-medium">✓ Inserida</span>}
                </label>
                <div className="relative">
                  <input
                    type={showApiKeys ? "text" : "password"}
                    value={groqKey}
                    onChange={(e) => setGroqKey(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-rose-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKeys((v) => !v)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                    title={showApiKeys ? "Ocultar chave" : "Ver chave"}
                  >
                    {showApiKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Supabase Connection Card */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-400" />
                <h2 className="text-sm font-medium text-white">Conexão com Banco de Dados Supabase (Tabela marcameet)</h2>
              </div>
              {supabaseUrl && supabaseAnonKey ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Configurado
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
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
                <div className="relative">
                  <input
                    type={showApiKeys ? "text" : "password"}
                    value={supabaseAnonKey}
                    onChange={(e) => setSupabaseAnonKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKeys((v) => !v)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                    title={showApiKeys ? "Ocultar chave" : "Ver chave"}
                  >
                    {showApiKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

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

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={connectionStatus === "testing"}
                  className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 text-slate-200 text-xs font-medium transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${connectionStatus === "testing" ? "animate-spin text-indigo-400" : "text-emerald-400"}`} />
                  <span>TESTAR CONEXÃO COM SUPABASE</span>
                </button>


              </div>
            </div>
          </div>

          {/* Botão Salvar */}
          <button
            type="submit"
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            <span>SALVAR CHAVES DE API & SUPABASE NA CONTA</span>
          </button>
        </form>
      </details>

      <section className="glass-card rounded-2xl p-5 space-y-3" aria-labelledby="team-heading">
        <h2 id="team-heading" className="text-base font-semibold text-white">Usuários e perfis</h2>
        <ul className="divide-y divide-slate-800">
          {teamProfiles.map(({ name, role }) => (
            <li key={name} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span className="font-medium text-slate-100">{name}</span>
              <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs text-indigo-200">{role}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
