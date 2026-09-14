"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Video, Mic, FileText, Settings, Radio } from "lucide-react";

export function Header() {
  const pathname = usePathname();

  const navItems = [
    { label: "Início", href: "/", icon: Home },
    { label: "Minhas Reuniões", href: "/meetings", icon: Video },
    { label: "Reunião Online", href: "/online-meet", icon: Radio, highlight: true },
    { label: "Gravar Reunião", href: "/record", icon: Mic },
    { label: "Resumos & Atas", href: "/tasks", icon: FileText },
    { label: "Configurações", href: "/settings", icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-[100] w-full max-w-full border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md px-4 sm:px-6 lg:px-10 py-5 flex items-center justify-between min-h-[88px] transition-all">
      {/* Brand / Logo (Ícone de Microfone) */}
      <Link href="/" className="flex items-center gap-3 group" title="Marca Meet - Início">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
          <Mic className="w-6 h-6 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-xl text-white tracking-tight">Marca Meet</span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium hidden sm:block">Inteligência de Reuniões</p>
        </div>
      </Link>

      {/* Menu Principal no Cabeçalho (Espaçado com Cabeçalho Alto e Tooltips Internos no Hover) */}
      <nav className="hidden md:flex items-center gap-6 lg:gap-8">
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

                {/* Ponto indicador de página ativa */}
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400"></span>
                )}

                {item.highlight && !isActive && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                )}
              </Link>

              {/* Nome da aba visível AO PASSAR O MOUSE (Hover), contido no cabeçalho expandido */}
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

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Link
          href="/online-meet"
          className="hidden lg:flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/20 border border-indigo-500/30 transition-all active:scale-95"
          title="Transcrever Reunião Online (Google Meet, Teams, Zoom)"
        >
          <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>Transcrever Reunião Online</span>
        </Link>

        <Link
          href="/record"
          className="hidden md:flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-rose-500/20 transition-all active:scale-95"
          title="Gravar Reunião Presencial ou de Áudio"
        >
          <Mic className="w-4 h-4" />
          <span>Gravar Reunião</span>
        </Link>
      </div>
    </header>
  );
}
