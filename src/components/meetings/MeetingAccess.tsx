"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { CompleteMeetingDetails } from "@/types/database";
import { loadMeetingAccess, meetingAccessClient, rememberProtectedMeeting, requestMeetingAccessLink, saveMeetingAccess, type MeetingVisibility } from "@/lib/supabase/meetingAccess";

export function useMeetingAccessUser() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const subscription = meetingAccessClient?.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  return user;
}

export function MeetingAccessLogin({ initialEmail = "" }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  if (!meetingAccessClient) return <p className="text-sm text-slate-300">O acesso verificado ainda não foi configurado.</p>;

  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => {
      event.preventDefault();
      setSending(true);
      setStatus("");
      try {
        await requestMeetingAccessLink(email);
        setStatus("Confira a caixa de entrada e abra o link para confirmar seu e-mail.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Não foi possível enviar o link.");
      } finally {
        setSending(false);
      }
    }}>
      <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} aria-label="E-mail para acesso"
        className="min-h-11 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm text-white" placeholder="Seu e-mail" />
      <button type="submit" disabled={sending} className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm text-white">Receber link de acesso</button>
      {status && <p role="status" className="basis-full text-sm text-indigo-200">{status}</p>}
    </form>
  );
}

export function MeetingAccess({ details }: { details: CompleteMeetingDetails }) {
  const user = useMeetingAccessUser();
  const ownerEmail = details.meeting.user_email?.trim().toLowerCase();
  const isOwner = Boolean(ownerEmail && user?.email_confirmed_at && user.email?.trim().toLowerCase() === ownerEmail);
  const [visibility, setVisibility] = useState<MeetingVisibility>("private");
  const [emails, setEmails] = useState("");
  const [team, setTeam] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setLoaded(false);
    setStatus("");
    if (!isOwner) return;
    let active = true;
    void loadMeetingAccess(details.meeting.id).then((settings) => {
      if (!active) return;
      setVisibility(settings.visibility);
      setEmails(settings.emails.join(", "));
      setTeam(settings.team);
      setShareId(settings.id);
      if (settings.id) rememberProtectedMeeting(details.meeting.id, settings.id);
      setLoaded(true);
    }).catch((error) => {
      if (active) setStatus(error.message || "Não foi possível consultar as permissões.");
    });
    return () => { active = false; };
  }, [details.meeting.id, isOwner, user?.id]);

  return (
    <details className="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3">
      <summary className="cursor-pointer font-semibold text-indigo-200">Gerenciar acesso</summary>
      <p className="text-sm text-slate-300">Particular é o padrão. Ao salvar, uma versão da reunião fica disponível apenas para quem tiver permissão. Salve novamente para atualizar o conteúdo compartilhado.</p>
      {!ownerEmail && <p className="text-sm text-amber-200">Esta reunião não tem proprietário confirmado e fica indisponível para compartilhamento.</p>}
      {ownerEmail && !user && <MeetingAccessLogin initialEmail={ownerEmail} />}
      {ownerEmail && user && !isOwner && <p className="text-sm text-amber-200">Entre com o e-mail do proprietário para alterar o acesso.</p>}
      {isOwner && loaded && (
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setStatus("");
          try {
            const id = await saveMeetingAccess(details, visibility, emails.split(/[\s,;]+/).filter(Boolean));
            setShareId(id);
            rememberProtectedMeeting(details.meeting.id, id);
            setStatus("Permissões salvas.");
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Não foi possível salvar as permissões.");
          } finally {
            setSaving(false);
          }
        }}>
          <label className="block text-sm text-slate-200">Quem pode abrir a reunião
            <select value={visibility} disabled={saving} onChange={(event) => setVisibility(event.target.value as MeetingVisibility)}
              className="mt-1 block min-h-11 rounded-lg border border-slate-600 bg-slate-950 px-3 text-white">
              <option value="private">Particular</option>
              <option value="selected">Pessoas selecionadas</option>
              <option value="team" disabled={!team}>Toda a equipe{team ? ` · ${team}` : " · equipe não configurada"}</option>
            </select>
          </label>
          {visibility === "selected" && (
            <label className="block text-sm text-slate-200">E-mails das contas autorizadas
              <textarea required value={emails} disabled={saving} onChange={(event) => setEmails(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-white" placeholder="Separe os e-mails por vírgulas" />
            </label>
          )}
          <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm text-white">Salvar acesso</button>
          {shareId && <span className="ml-3 inline-flex flex-wrap gap-3 text-sm text-indigo-300">
            <a className="underline" href={`/meetings/shared/${shareId}`}>Abrir versão protegida</a>
            <button type="button" className="underline" onClick={async () => {
              try {
                await navigator.clipboard.writeText(new URL(`/meetings/shared/${shareId}`, location.origin).href);
                setStatus("Link copiado.");
              } catch {
                setStatus("Abra a versão protegida para copiar o endereço.");
              }
            }}>Copiar link</button>
          </span>}
        </form>
      )}
      {status && <p role="status" className="text-sm text-indigo-200">{status}</p>}
    </details>
  );
}
