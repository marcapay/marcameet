"use client";

import { useState, useEffect } from "react";
import { Zap, ShieldCheck, Smartphone, Check, X } from "lucide-react";
import { enableBackgroundMode, isBackgroundModeEnabled } from "@/lib/audio/recordingKeepAlive";

export function BackgroundModePrompt() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [justActivated, setJustActivated] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const active = isBackgroundModeEnabled();
      setIsEnabled(active);
      const dismissed = localStorage.getItem("marcameet_bg_prompt_dismissed") === "true";
      setIsDismissed(dismissed);

      if (active) {
        // Garantir que os serviços de keep-alive estejam sincronizados ao carregar a página
        enableBackgroundMode().catch(() => {});
      }
    }
  }, []);

  const handleActivate = async () => {
    const success = await enableBackgroundMode();
    if (success) {
      setIsEnabled(true);
      setJustActivated(true);
      setTimeout(() => setJustActivated(false), 5000);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("marcameet_bg_prompt_dismissed", "true");
    }
  };

  if (justActivated) {
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-8 mt-3 animate-fadeIn">
        <div className="p-3.5 rounded-2xl bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 text-xs font-bold shadow-xl flex items-center justify-between gap-3 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Check className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Modo Segundo Plano & Tela Apagada Ativado!</p>
              <p className="text-[11px] text-emerald-300/80">
                O Marca Meet continuará gravando normalmente mesmo com a tela do celular apagada ou bloqueada.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isEnabled) {
    return null;
  }

  if (isDismissed) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-8 mt-3 animate-fadeIn">
      <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-indigo-950/90 via-slate-900/95 to-purple-950/90 border border-indigo-500/40 text-slate-100 shadow-2xl backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
            <Zap className="w-6 h-6 text-amber-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-bold uppercase tracking-wider border border-indigo-500/30">
                Recomendado para Celulares
              </span>
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                Sem interrupções
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
              Ativar Gravação Fora de Tela (Segundo Plano)?
            </h3>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Permite que o site continue gravando reuniões com 100% de precisão mesmo ao apagar a tela do celular, bloquear o aparelho ou mudar de aba.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0 justify-end">
          <button
            onClick={handleDismiss}
            className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-all"
            title="Ignorar aviso"
          >
            Depois
          </button>
          <button
            onClick={handleActivate}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-xs shadow-lg shadow-indigo-600/30 border border-indigo-400/40 transition-all active:scale-95 whitespace-nowrap"
          >
            <Zap className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span>ATIVAR MODO SEGUNDO PLANO (1-CLIQUE)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
