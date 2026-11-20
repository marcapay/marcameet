"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MeetingAccessLogin, useMeetingAccessUser } from "@/components/meetings/MeetingAccess";
import { MeetingChat } from "@/components/meetings/MeetingChat";
import { meetingAccessClient } from "@/lib/supabase/meetingAccess";
import type { CompleteMeetingDetails } from "@/types/database";

export default function ProtectedMeetingPage() {
  const { id } = useParams<{ id: string }>();
  const user = useMeetingAccessUser();
  const [state, setState] = useState<{ id: string; user: string; details: CompleteMeetingDetails | null } | null>(null);
  const current = state?.id === id && state.user === user?.id ? state : null;
  const meeting = current?.details;

  useEffect(() => {
    const client = meetingAccessClient;
    const userId = user?.id;
    if (!client || !userId) return;
    let active = true;
    async function refresh() {
      if (!client || !userId) return;
      const { data, error } = await client.from("protected_meetings").select("details").eq("id", id).maybeSingle();
      if (active) setState({ id, user: userId, details: error ? null : (data?.details ?? null) });
    }
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [id, user?.id]);

  async function verifyAccess() {
    const client = meetingAccessClient;
    if (!client || !user) throw new Error("Entre para acessar a reunião.");
    const { data, error } = await client.from("protected_meetings").select("id").eq("id", id).maybeSingle();
    if (!data || error) {
      setState({ id, user: user.id, details: null });
      throw new Error("A reunião não está disponível para esta conta.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link className="text-sm text-indigo-200 underline" href="/meetings">Minhas Reuniões</Link>
      {!user ? <MeetingAccessLogin /> : !current ? <p role="status">Verificando acesso…</p> : !meeting ? (
        <p role="status">Reunião indisponível para esta conta.</p>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-white">{meeting.meeting.title}</h1>
          {meeting.summary && <section className="space-y-2 rounded-2xl border border-slate-800 p-4">
            <h2 className="font-semibold text-white">Resumo executivo</h2>
            <p>{meeting.summary.objective}</p>
            <p>{meeting.summary.conclusions}</p>
          </section>}
          <MeetingChat key={id} details={{ ...meeting, meeting: { ...meeting.meeting, id, user_id: user.id } }} executive persistHistory={false} beforeSend={verifyAccess} />
          <details className="rounded-2xl border border-slate-800 p-4">
            <summary className="cursor-pointer font-semibold text-indigo-200">Transcrição</summary>
            <p className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap">{meeting.transcript?.raw_text || "Transcrição indisponível."}</p>
          </details>
          <button type="button" onClick={() => void verifyAccess().then(() => window.print()).catch(() => {})} className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm text-white">Exportar PDF</button>
        </>
      )}
    </div>
  );
}
