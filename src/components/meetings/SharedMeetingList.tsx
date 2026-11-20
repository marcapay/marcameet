"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MeetingAccessLogin, useMeetingAccessUser } from "./MeetingAccess";
import { meetingAccessClient } from "@/lib/supabase/meetingAccess";
import type { CompleteMeetingDetails } from "@/types/database";

export function SharedMeetingList({ query }: { query: string }) {
  const user = useMeetingAccessUser();
  const [result, setResult] = useState<{ userId: string; rows: { id: string; details: CompleteMeetingDetails }[] } | null>(null);
  const rows = result && result.userId === user?.id ? result.rows : [];
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    const client = meetingAccessClient;
    const userId = user?.id;
    if (!client || !userId) return;
    let active = true;

    async function refresh() {
      if (!client || !userId) return;
      const { data, error } = await client.from("protected_meetings")
        .select("id, details").order("updated_at", { ascending: false });
      if (!active) return;
      setResult({ userId, rows: error ? [] : data ?? [] });
      setError(error ? "Não foi possível consultar as reuniões protegidas." : "");
    }

    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user?.id]);

  if (!meetingAccessClient) return null;
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const visible = rows.filter(({ details }) => !search || [
    details.meeting.title,
    details.meeting.description,
    details.summary?.objective,
    details.transcript?.raw_text,
  ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(search)));
  return (
    <details open={Boolean(user)} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
      <summary className="cursor-pointer font-semibold text-indigo-200">Reuniões com acesso verificado</summary>
      {!user ? <MeetingAccessLogin /> : (
        <>
          <p className="text-sm text-slate-300">{user.email}</p>
          <button type="button" className="text-sm text-indigo-200 underline" onClick={() => void meetingAccessClient?.auth.signOut()}>Sair do acesso verificado</button>
          {error ? <p role="alert" className="text-sm text-amber-200">{error}</p> : (
            visible.length ? <ul className="space-y-2">
              {visible.map(({ id, details }) => <li key={id}><Link className="text-sm text-indigo-200 underline" href={`/meetings/shared/${id}`}>{details.meeting.title}</Link></li>)}
            </ul> : <p className="text-sm text-slate-400">Nenhuma reunião disponível para esta busca.</p>
          )}
        </>
      )}
    </details>
  );
}
