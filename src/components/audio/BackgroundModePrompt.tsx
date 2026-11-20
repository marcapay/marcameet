"use client";

import { useState, useEffect } from "react";
import { Smartphone, ShieldCheck, X } from "lucide-react";

export function BackgroundModePrompt() {
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const dismissed = localStorage.getItem("marcameet_wakelock_notice_dismissed") === "true";
      setIsDismissed(dismissed);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("marcameet_wakelock_notice_dismissed", "true");
    }
  };

  if (isDismissed) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-8 mt-3 animate-fadeIn">
      <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/95 border border-indigo-500/30 text-slate-200 shadow-lg flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xs leading-relaxed">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span>Mantenha a aba do gravador aberta</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 inline" />
            </span>
            <span className="text-slate-400">
              No celular, mantenha a tela ligada e volte ao gravador depois de atender uma ligação para conferir a captura. Se fechar a aba do gravador, a captura para.
            </span>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors shrink-0"
          title="Fechar aviso"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
