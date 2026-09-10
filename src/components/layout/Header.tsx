"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Video, Mic, FileText, Settings, Radio } from "lucide-react";

export function Header() {
  const pathname = usePathname();

  const navItems = [
    { label: "Início", href: "/", icon: Home },
    { label: "Reuniões", href: "/meetings", icon: Video },
    { label: "Reunião Online", href: "/online-meet", icon: Radio, highlight: true },
    { label: "Gravar", href: "/record", icon: Mic },
    { label: "Resumos", href: "/tasks", icon: FileText },
    { label: "Configurações", href: "/settings", icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-4 lg:px-8 py-3.5 flex items-center justify-between">
      {/* Brand / Logo (Ícone de Microfone) */}
      <Link href="/" className="flex items-center gap-2.5 group">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
          <Mic className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-lg text-white tracking-tight">Marca Meet</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium hidden sm:block">Inteligência de Reuniões</p>
        </div>
      </Link>

      {/* Menu Principal no Cabeçalho (Espaçado e Sem Marcação de Caixas) */}
      <nav className="hidden md:flex items-center gap-6 lg:gap-8">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));

          return (
            <div key={item.href} className="relative group">
              <Link
                href={item.href}
                className="p-1.5 flex items-center justify-center transition-all duration-200 relative"
              >
                <Icon
                  className={`w-6 h-6 transition-all duration-200 ${
                    isActive
                      ? "text-indigo-400 scale-110 drop-shadow-[0_0_10px_rgba(99,102,241,0.6)]"
                      : "text-slate-400 hover:text-slate-100 group-hover:scale-110"
                  }`}
                />

                {/* Ponto indicador de página ativa */}
                {isActive && (
                  <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400"></span>
                )}

                {item.highlight && !isActive && (
                  <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                )}
              </Link>

              {/* Tooltip elegante com o nome da aba ao passar o cursor */}
              <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50">
                <div className="px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 text-white text-[11px] font-bold whitespace-nowrap shadow-2xl backdrop-blur-md">
                  {item.label}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Action Buttons */}
      <div className="flex items-center gap-2.5">
        <Link
          href="/online-meet"
          className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/20 border border-indigo-500/30 transition-all active:scale-95"
        >
          <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>Transcrever Reunião Online</span>
        </Link>

        <Link
          href="/record"
          className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-rose-500/20 transition-all active:scale-95"
        >
          <Mic className="w-4 h-4" />
          <span>Gravar Reunião</span>
        </Link>
      </div>
    </header>
  );
}
