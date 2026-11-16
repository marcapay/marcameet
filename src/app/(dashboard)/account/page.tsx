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
  Calendar,
  ArrowRight,
  KeyRound,
  Sparkles,
  HardDrive,
  Cloud,
} from "lucide-react";
import {
  getCurrentAccount,
  subscribeAccountChange,
  registerAccount,
  loginAccount,
  resetAccountPassword,
  updateAccountProfile,
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
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { CompleteMeetingDetails, UserAccount } from "@/types/database";

export default function AccountPage() {
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [meetings, setMeetings] = useState<CompleteMeetingDetails[]>([]);
  const [knownAccounts, setKnownAccounts] = useState<UserAccount[]>([]);
  const [authTab, setAuthTab] = useState<"login" | "register" | "reset">("register");

  // Campos de formulário
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Edição de perfil
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");

  // Feedback e Sincronização
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cloudConfigured, setCloudConfigured] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const current = getCurrentAccount();
    setAccount(current);
    if (current) {
      setEditName(current.name);
      setEditCompany(current.company || "");
    }
    setMeetings(getLocalMeetings());
    setCloudConfigured(isSupabaseConfigured());

    listKnownDeviceAccounts().then((list) => {
      setKnownAccounts(list);
      if (list.length > 0 && !current) {
        setAuthTab("login");
      }
    });

    const unsubAcc = subscribeAccountChange((acc) => {
      setAccount(acc);
      if (acc) {
        setEditName(acc.name);
        setEditCompany(acc.company || "");
      }
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
          ? `Sincronização concluída! ${res.totalSaved} reunião(ões) protegidas na sua conta e na nuvem Supabase.`
          : `Sincronização concluída! ${res.totalSaved} reunião(ões) salvas permanentemente na sua conta.`
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
    } catch (err) {
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
    showSuccess("Você saiu da conta. Suas reuniões continuam salvas e seguras para quando entrar novamente.");
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
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <UserCheck className="w-6 h-6 text-indigo-400" />
            <span>Minha Conta & Proteção de Reuniões</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Mantenha todas as suas gravações, transcrições e atas salvas permanentemente na sua conta.
          </p>
        </div>

        {account && (
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-800 hover:border-rose-500/40 text-xs font-bold transition-all self-start sm:self-auto"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair da Conta</span>
          </button>
        )}
      </div>

      {/* Alertas */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center gap-2.5 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center gap-2.5 shadow-lg">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* VISÃO QUANDO NÃO LOGADO: CRIAR CONTA / ENTRAR */}
      {!account ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 p-6 sm:p-8 rounded-3xl glass-card border border-indigo-500/30 shadow-2xl space-y-6">
            {/* Seletor de Abas */}
            <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthTab("register");
                  setErrorMessage(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
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
                className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
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
                className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
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
                  <h2 className="text-lg font-extrabold text-white">Crie sua conta no Marca Meet</h2>
                  <p className="text-xs text-slate-400">
                    Ao criar sua conta, todas as reuniões atuais ({meetings.length}) e futuras ficarão salvas e vinculadas a você.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Seu Nome Completo *</label>
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
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Seu E-mail *</label>
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
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Empresa ou Equipe (Opcional)</label>
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
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Criar Senha *</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                      <input
                        type="password"
                        required
                        minLength={4}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Mínimo 4 caracteres"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Confirmar Senha *</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                      <input
                        type="password"
                        required
                        minLength={4}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a senha"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
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
                  <h2 className="text-lg font-extrabold text-white">Entrar na sua Conta</h2>
                  <p className="text-xs text-slate-400">
                    Acesse suas reuniões salvas, transcrições, tarefas e resumos executivos.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">E-mail da Conta</label>
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
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Senha</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Sua senha"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-extrabold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{isSubmitting ? "ENTRANDO..." : "ENTRAR E CARREGAR MINHAS REUNIÕES"}</span>
                </button>

                {knownAccounts.length > 0 && (
                  <div className="pt-3 border-t border-slate-800/80 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Contas utilizadas neste dispositivo:
                    </p>
                    <div className="space-y-1.5">
                      {knownAccounts.map((acc) => (
                        <button
                          key={acc.email}
                          type="button"
                          onClick={() => {
                            setEmail(acc.email);
                          }}
                          className="w-full p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 flex items-center justify-between text-left transition-all"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xs font-extrabold text-indigo-300">
                              {getInitials(acc.name)}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-200">{acc.name}</p>
                              <p className="text-[11px] text-slate-400">{acc.email}</p>
                            </div>
                          </div>
                          <span className="text-[11px] text-indigo-400 font-semibold">Selecionar →</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* ABA: REDEFINIR SENHA */}
            {authTab === "reset" && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <h2 className="text-lg font-extrabold text-white">Redefinir Senha da Conta</h2>
                  <p className="text-xs text-slate-400">
                    Informe o e-mail da sua conta e defina uma nova senha de acesso.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">E-mail Cadastrado</label>
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
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Nova Senha</label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Nova senha"
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Confirmar Nova Senha</label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a nova senha"
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-sm shadow-lg transition-all active:scale-95"
                >
                  {isSubmitting ? "SALVANDO..." : "ATUALIZAR SENHA E ENTRAR"}
                </button>
              </form>
            )}
          </div>

          {/* Coluna Lateral: Benefícios da Conta */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/30">
                  <ShieldCheck className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">Proteção Tripla Anti-Perda</h3>
                  <p className="text-[11px] text-slate-400">Como suas reuniões são salvas</p>
                </div>
              </div>

              <ul className="space-y-3 text-xs text-slate-300">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Vínculo Automático à Conta:</strong> Todas as reuniões já gravadas neste aparelho ({meetings.length}) são vinculadas automaticamente à sua conta ao entrar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Banco Permanente IndexedDB:</strong> Protegido contra limpeza automática do navegador no celular e no computador.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Sincronização em Nuvem (Supabase):</strong> Sincroniza transcrições, decisões, tarefas e resumos na nuvem para acessar de qualquer lugar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Backup Exportável (.JSON):</strong> Baixe ou restaure cópias completas das suas reuniões a qualquer momento com 1 clique.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        /* VISÃO QUANDO LOGADO: PAINEL DA CONTA */
        <div className="space-y-6">
          {/* Card Principal do Usuário */}
          <div className="p-6 rounded-3xl glass-card border border-emerald-500/30 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-500 flex items-center justify-center text-xl font-black text-white shadow-lg shadow-indigo-500/20">
                  {getInitials(account.name)}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black text-white">{account.name}</h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      Conta Protegida
                    </span>
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
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-200 transition-all self-start sm:self-auto"
              >
                {isEditingProfile ? "Cancelar Edição" : "Editar Perfil"}
              </button>
            </div>

            {isEditingProfile && (
              <form onSubmit={handleSaveProfile} className="pt-4 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Nome</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Empresa / Cargo</label>
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
                  className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all"
                >
                  Salvar Alterações
                </button>
              </form>
            )}
          </div>

          {/* Status de Armazenamento & Ações de Backup */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl glass-card border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Reuniões Salvas na Conta</span>
                <Video className="w-4 h-4 text-indigo-400" />
              </div>
              <p className="text-2xl font-black text-white">{meetings.length}</p>
              <p className="text-[11px] text-emerald-400 font-semibold">✓ Vinculadas a {account.email}</p>
            </div>

            <div className="p-5 rounded-2xl glass-card border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Banco Local Permanente</span>
                <HardDrive className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-base font-extrabold text-emerald-300">IndexedDB Ativo</p>
              <p className="text-[11px] text-slate-400">Protegido contra perda ao fechar o navegador</p>
            </div>

            <div className="p-5 rounded-2xl glass-card border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Sincronização em Nuvem</span>
                <Cloud className="w-4 h-4 text-indigo-400" />
              </div>
              <p className="text-base font-extrabold text-white">
                {cloudConfigured ? "Supabase Conectado" : "Armazenamento Local + Backup"}
              </p>
              <p className="text-[11px] text-slate-400">
                {cloudConfigured ? "Sincronizado automaticamente" : "Configure o Supabase em Ajustes para nuvem"}
              </p>
            </div>
          </div>

          {/* Ferramentas de Sincronização e Backup de Segurança */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div>
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>Sincronização & Backup de Segurança das Reuniões</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Sincronize suas reuniões com a nuvem ou baixe/importe uma cópia de segurança completa (.json) para nunca perder nenhum dado.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
                <span>{isSyncing ? "SINCRONIZANDO..." : "SINCRONIZAR REUNIÕES AGORA"}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadBackup}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>BAIXAR BACKUP DAS REUNIÕES (.JSON)</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs transition-all flex items-center gap-2"
              >
                <Upload className="w-4 h-4 text-indigo-400" />
                <span>RESTAURAR / IMPORTAR BACKUP (.JSON)</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportBackupFile}
                className="hidden"
              />
            </div>
          </div>

          {/* Lista de Reuniões Vinculadas à Conta */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Video className="w-4 h-4 text-indigo-400" />
                <span>Reuniões Salvas na Sua Conta ({meetings.length})</span>
              </h3>
              <Link href="/meetings" className="text-xs font-bold text-indigo-400 hover:underline">
                Ver todas →
              </Link>
            </div>

            {meetings.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-900/50 border border-slate-800 text-center space-y-2">
                <p className="text-xs font-semibold text-slate-300">Nenhuma reunião gravada ainda nesta conta.</p>
                <Link
                  href="/record"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold mt-2"
                >
                  <span>Gravar Primeira Reunião</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {meetings.slice(0, 8).map((item) => (
                  <Link
                    key={item.meeting.id}
                    href={`/meetings/${item.meeting.id}`}
                    className="p-3.5 rounded-2xl bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 flex items-center justify-between gap-3 transition-all group"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Salva na conta"></span>
                        <p className="text-xs font-bold text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
                          {item.meeting.title}
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-1">
                        <Calendar className="w-3 h-3" />
                        <span>
                          {new Date(item.meeting.meeting_date).toLocaleDateString("pt-BR", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>•</span>
                        <span className="text-emerald-400 font-semibold">Salva na conta</span>
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
