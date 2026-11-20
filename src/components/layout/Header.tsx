"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Video, Mic, FileText, Settings, Radio, UserCheck, UserPlus, ShieldCheck } from "lucide-react";
import { getCurrentAccount, subscribeAccountChange } from "@/lib/auth/accountSystem";
import { UserAccount } from "@/types/database";

export function Header() {
  const pathname = usePathname();
  const [account, setAccount] = useState<UserAccount | null>(null);

  useEffect(() => {
    setAccount(getCurrentAccount());
    const unsub = subscribeAccountChange((acc) => {
      setAccount(acc);
    });
    return () => unsub();
  }, []);

  const navItems = [
    { label: "Início", href: "/", icon: Home },
    { label: "Minhas Reuniões", href: "/meetings", icon: Video },
    { label: "Reunião Online", href: "/online-meet", icon: Radio, highlight: true },
    { label: "Gravar Reunião", href: "/record", icon: Mic },
    { label: "Resumos & Atas", href: "/tasks", icon: FileText },
    { label: "Minha Conta", href: "/account", icon: UserCheck },
  ];

  const getInitials = (name: string) =>
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase())
      .join("");

  return (
    <header className="sticky top-0 z-[100] w-full max-w-full border-b border-slate-800 bg-slate-950/98 px-4 sm:px-6 lg:px-10 py-5 flex items-center justify-between min-h-[88px]">
      {/* Brand / Logo (Ícone de Microfone) */}
      <Link href="/" className="flex items-center gap-3 group" title="Marca Reuniões - Início">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
          <Mic className="w-6 h-6 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-xl text-white tracking-tight">Marca Reuniões</span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium hidden sm:block">Inteligência de Reuniões</p>
        </div>
      </Link>

      {/* Menu Principal no Cabeçalho */}
      <nav className="hidden md:flex items-center gap-5 lg:gap-7">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));

          return (
            <div key={item.href} className="relative group flex flex-col items-center justify-center py-1">
              <Link
                href={item.href}
                title={item.label}
                className={`p-2.5 rounded-2xl flex items-center justify-center transition-all duration-200 relative ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-md shadow-indigo-500/10"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-900/80"
                }`}
              >
                <Icon
                  className={`w-6 h-6 transition-all duration-200 ${
                    isActive
                      ? "text-indigo-400 scale-110 drop-shadow-[0_0_10px_rgba(99,102,241,0.6)]"
                      : "text-slate-400 group-hover:text-slate-100 group-hover:scale-110"
                  }`}
                />

                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400"></span>
                )}

                {item.highlight && !isActive && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                )}
              </Link>

              <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none flex flex-col items-center transform translate-y-1 group-hover:translate-y-0 z-50">
                <div className="w-2 h-2 rotate-45 bg-slate-900 border-t border-l border-indigo-500/50 -mb-1 z-10"></div>
                <div className="px-3 py-1 rounded-xl bg-slate-900/95 border border-indigo-500/50 text-indigo-200 text-xs font-bold whitespace-nowrap shadow-xl backdrop-blur-md">
                  {item.label}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Action Buttons & Conta do Usuário */}
      <div className="flex items-center gap-2.5">
        <Link
          href="/online-meet"
          className="hidden xl:flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/20 border border-indigo-500/30 transition-all active:scale-95"
          title="Transcrever Reunião Online (Google Meet, Teams, Zoom)"
        >
          <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>Reunião Online</span>
        </Link>

        <Link
          href="/record"
          className="hidden lg:flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-rose-500/20 transition-all active:scale-95"
          title="Gravar Reunião Presencial ou de Áudio"
        >
          <Mic className="w-4 h-4" />
          <span>Gravar</span>
        </Link>

        {/* Botão de Conta / Perfil (Visível em Desktop e Mobile) */}
        {account ? (
          <Link
            href="/account"
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-emerald-500/40 transition-all group"
            title={`Conectado como ${account.name} (${account.email}) - Reuniões salvas na conta`}
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-emerald-500 flex items-center justify-center text-xs font-black text-white shadow-sm">
              {getInitials(account.name)}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-extrabold text-white leading-tight truncate max-w-[120px]">
                {account.name.split(" ")[0]}
              </p>
              <p className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 leading-tight">
                <ShieldCheck className="w-2.5 h-2.5" />
                <span>Salvo</span>
              </p>
            </div>
          </Link>
        ) : (
          <Link
            href="/account"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:text-white font-bold text-xs transition-all"
            title="Entrar ou Criar Conta para salvar suas reuniões"
          >
            <UserPlus className="w-4 h-4 text-indigo-400" />
            <span>Minha Conta</span>
          </Link>
        )}
      </div>
    </header>
  );
}
