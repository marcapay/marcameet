"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Video, Mic, FileText, Settings } from "lucide-react";

export function MobileNav() {
  const pathname = usePathname();

  const navItems = [
    { label: "Início", href: "/", icon: Home },
    { label: "Reuniões", href: "/meetings", icon: Video },
    { label: "GRAVAR", href: "/record", icon: Mic, isCenter: true },
    { label: "Resumos", href: "/tasks", icon: FileText },
    { label: "Ajustes", href: "/settings", icon: Settings },
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 border-t border-slate-800/90 backdrop-blur-lg px-2 py-1.5 shadow-2xl">
      <nav className="flex items-center justify-around relative">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));

          if (item.isCenter) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center -mt-6 group focus:outline-none"
              >
                <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-rose-600 via-indigo-600 to-indigo-500 p-0.5 shadow-lg shadow-rose-600/30 group-active:scale-95 transition-transform">
                  <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center border border-rose-500/50 group-hover:bg-rose-600/20 transition-colors">
                    <Mic className="w-7 h-7 text-rose-400 group-hover:text-white transition-colors animate-pulse" />
                  </div>
                </div>
                <span className="text-[10px] font-black uppercase text-rose-400 tracking-wider mt-1">
                  {item.label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all ${
                isActive ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span className={`text-[11px] font-medium ${isActive ? "font-bold text-indigo-300" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
