"use client";

import Link from "next/link";

export default function MeetingError({ reset }: { reset: () => void }) {
  return (
    <section className="glass-card mx-auto max-w-xl space-y-4 rounded-2xl p-6">
      <h1 className="text-lg font-semibold">Não foi possível abrir esta reunião</h1>
      <p className="text-sm text-slate-300">Tente carregar novamente ou volte à lista de reuniões.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white">
          Tentar novamente
        </button>
        <Link href="/meetings" className="inline-flex min-h-11 items-center px-3 text-sm text-indigo-300">
          Voltar para Minhas Reuniões
        </Link>
      </div>
    </section>
  );
}
