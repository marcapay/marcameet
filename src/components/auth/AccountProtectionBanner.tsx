"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, UserPlus, ArrowRight } from "lucide-react";
import { getCurrentAccount, subscribeAccountChange } from "@/lib/auth/accountSystem";
import { UserAccount } from "@/types/database";

export function AccountProtectionBanner() {
  const pathname = usePathname();
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setAccount(getCurrentAccount());
    const unsub = subscribeAccountChange((acc) => {
      setAccount(acc);
    });
    return () => unsub();
  }, []);

  if (!mounted || pathname === "/account" || pathname === "/settings") return null;

  if (account) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-indigo-950/90 via-slate-900/95 to-indigo-950/90 border-b border-indigo-500/30 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-xs text-indigo-100">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 shrink-0">
            <ShieldCheck className="w-4 h-4 text-indigo-300" />
          </div>
          <span>
            <strong>Proteja suas reuniões:</strong> Crie sua conta gratuita ou faça login em Minha Conta para que todas as gravações e atas fiquem salvas na sua conta e nunca se percam.
          </span>
        </div>

        <Link
          href="/account"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/25 transition-all shrink-0 self-start sm:self-auto"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Criar Conta / Entrar</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
