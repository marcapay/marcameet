"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Video, Mic, FileText, Settings } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { label: "Início", href: "/", icon: Home },
    { label: "Reuniões", href: "/meetings", icon: Video },
    { label: "Gravar", href: "/record", icon: Mic, highlight: true },
    { label: "Resumos", href: "/tasks", icon: FileText },
    { label: "Configurações", href: "/settings", icon: Settings },
  ];

  return (
    <aside className="hidden md:flex flex-col w-64 border-r border-slate-800/80 bg-slate-950/60 p-4 min-h-[calc(100vh-65px)]">
      {/* Navigation Links */}
      <nav className="flex-1 space-y-1.5">
        <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Menu Principal</p>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all ${
                isActive
                  ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
              <span>{item.label}</span>
              {item.highlight && (
                <span className="ml-auto w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
