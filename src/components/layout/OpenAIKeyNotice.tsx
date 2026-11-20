"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getActiveApiKeys } from "@/lib/ai";
import { subscribeOpenAIHealth, verifyOpenAITranscriptionKey, type OpenAIHealth } from "@/lib/ai/openaiHealth";
import { OPENAI_KEY_CHANGED } from "@/lib/storage/keysStorage";

const notices: Partial<Record<OpenAIHealth, [string, string]>> = {
  missing: ["Chave da OpenAI não configurada", "Configure a chave em Minha Conta para usar a transcrição pela OpenAI."],
  rejected: ["Chave da OpenAI recusada", "A chave pode ter sido revogada ou copiada incorretamente. Confira em Minha Conta."],
  permission: ["Acesso à OpenAI indisponível", "Confira as permissões da chave e o acesso do projeto ao modelo de transcrição."],
  quota: ["OpenAI sem crédito disponível", "Confira o saldo ou o limite de cobrança do projeto da OpenAI."],
  limited: ["Limite temporário da OpenAI", "Aguarde um pouco e tente transcrever novamente."],
  unverified: ["Não foi possível verificar a OpenAI", "Confira a conexão. A gravação pode continuar, mas a transcrição pela OpenAI pode ficar pendente."],
};

export function OpenAIKeyNotice() {
  const [state, setState] = useState<OpenAIHealth | null>(null);

  useEffect(() => {
    let key: string | undefined;
    let checkedAt = 0;
    let pending: AbortController | undefined;
    let lastRequestFailure: OpenAIHealth | undefined;

    function refresh(force = false) {
      const next = getActiveApiKeys().openaiKey;
      if (next === key && !force && Date.now() - checkedAt < 60000) return;
      if (next !== key || force) lastRequestFailure = undefined;
      key = next;
      checkedAt = Date.now();
      pending?.abort();
      pending = undefined;
      if (!key) {
        setState("missing");
        return;
      }
      const request = new AbortController();
      pending = request;
      const timeout = setTimeout(() => request.abort(), 8000);
      void verifyOpenAITranscriptionKey(key, request.signal).then((result) => {
        if (pending === request) setState(lastRequestFailure ?? result);
      }).finally(() => clearTimeout(timeout));
    }

    const wake = () => { if (document.visibilityState === "visible") refresh(); };
    const keyChanged = () => refresh(true);
    const unsubscribe = subscribeOpenAIHealth((requestKey, result) => {
      if (requestKey !== key) return;
      lastRequestFailure = result === "ready" ? undefined : result;
      setState(result);
    });

    refresh();
    window.addEventListener("focus", wake);
    window.addEventListener("online", keyChanged);
    window.addEventListener(OPENAI_KEY_CHANGED, keyChanged);
    document.addEventListener("visibilitychange", wake);
    return () => {
      const request = pending;
      pending = undefined;
      request?.abort();
      unsubscribe();
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", keyChanged);
      window.removeEventListener(OPENAI_KEY_CHANGED, keyChanged);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const notice = state ? notices[state] : undefined;
  if (!notice) return null;

  return (
    <aside role="alert" className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-950/50 p-3 text-amber-100 sm:gap-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{notice[0]}</p>
        <p className="text-xs leading-relaxed text-amber-100/80">{notice[1]}</p>
      </div>
      <Link href="/account" className="inline-flex min-h-8 items-center rounded-lg px-2 text-xs font-semibold text-amber-100 underline">Minha Conta</Link>
    </aside>
  );
}
