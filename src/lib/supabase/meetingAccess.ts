import { createClient } from "@supabase/supabase-js";
import type { CompleteMeetingDetails } from "@/types/database";

export type MeetingVisibility = "private" | "selected" | "team";

export interface MeetingAccessSettings {
  id: string | null;
  visibility: MeetingVisibility;
  emails: string[];
  team: string | null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const meetingAccessClient = url && key && !url.includes("placeholder") && !key.includes("placeholder")
  ? createClient(url, key, { auth: { storageKey: "marcameet-verified-access", detectSessionInUrl: true } })
  : null;

export async function requestMeetingAccessLink(email: string) {
  if (!meetingAccessClient) throw new Error("O acesso verificado ainda não foi configurado.");
  const redirectPath = location.pathname.startsWith("/meetings/") ? location.pathname : "/meetings";
  const { error } = await meetingAccessClient.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: new URL(redirectPath, location.origin).href },
  });
  if (error) throw new Error(error.message);
}

export async function loadMeetingAccess(source: string): Promise<MeetingAccessSettings> {
  if (!meetingAccessClient) throw new Error("O acesso verificado ainda não foi configurado.");
  const { data, error } = await meetingAccessClient.rpc("get_protected_meeting_settings", { source });
  if (error) throw new Error(error.message);
  return data as MeetingAccessSettings;
}

export async function saveMeetingAccess(details: CompleteMeetingDetails, visibility: MeetingVisibility, emails: string[]) {
  if (!meetingAccessClient) throw new Error("O acesso verificado ainda não foi configurado.");
  const { support_materials: _localMaterials, ...payload } = details;
  const { data, error } = await meetingAccessClient.rpc("save_protected_meeting", {
    source: details.meeting.id, payload, access_mode: visibility, emails,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

const protectedMark = (source: string) => `marcameet-protected:${source}`;

export function rememberProtectedMeeting(source: string, id: string) {
  try { localStorage.setItem(protectedMark(source), id); } catch {}
}

export async function removeProtectedMeeting(details: CompleteMeetingDetails): Promise<boolean> {
  const source = details.meeting.id;
  const known = localStorage.getItem(protectedMark(source));
  if (!meetingAccessClient) return !known;
  const { data: { session } } = await meetingAccessClient.auth.getSession();
  if (!session || session.user.email?.toLowerCase() !== details.meeting.user_email?.toLowerCase()) return !known;
  const { error } = await meetingAccessClient.rpc("delete_protected_meeting", { source });
  if (error) return false;
  localStorage.removeItem(protectedMark(source));
  return true;
}
