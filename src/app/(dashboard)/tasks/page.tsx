import { redirect } from "next/navigation";

export default function LegacyMeetingSummaries({
  searchParams,
}: {
  searchParams: { meetingId?: string | string[] };
}) {
  const meetingId = searchParams.meetingId;
  redirect(typeof meetingId === "string" && meetingId.trim()
    ? `/meetings/${encodeURIComponent(meetingId)}`
    : "/meetings");
}
