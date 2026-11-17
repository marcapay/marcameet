import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface CloudSyncData {
  supa_url?: string;
  supa_anon_key?: string;
  ai_openai_key?: string;
  ai_gemini_key?: string;
  ai_groq_key?: string;
  accounts: Record<string, any>;
  meetings: Record<string, any>;
  chunks?: Record<string, any>;
  updated_at: string;
}

const TMP_FILE = path.join("/tmp", "marcameet_cloud_sync_v2.json");

declare global {
  // eslint-disable-next-line no-var
  var __marcameetCloudSyncV2: CloudSyncData | undefined;
}

function readSyncState(): CloudSyncData {
  if (globalThis.__marcameetCloudSyncV2) {
    return globalThis.__marcameetCloudSyncV2;
  }
  try {
    if (fs.existsSync(TMP_FILE)) {
      const raw = fs.readFileSync(TMP_FILE, "utf-8");
      const parsed = JSON.parse(raw) as CloudSyncData;
      if (!parsed.accounts) parsed.accounts = {};
      if (!parsed.meetings) parsed.meetings = {};
      globalThis.__marcameetCloudSyncV2 = parsed;
      return parsed;
    }
  } catch {}

  const initial: CloudSyncData = {
    supa_url: "https://xuooojiaslhwaejsgjxh.supabase.co",
    accounts: {},
    meetings: {},
    updated_at: new Date().toISOString(),
  };
  globalThis.__marcameetCloudSyncV2 = initial;
  return initial;
}

function writeSyncState(state: CloudSyncData) {
  globalThis.__marcameetCloudSyncV2 = state;
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(state), "utf-8");
  } catch {}
}

export async function GET() {
  const state = readSyncState();
  return NextResponse.json({
    ok: true,
    supa_url: state.supa_url || "https://xuooojiaslhwaejsgjxh.supabase.co",
    supa_anon_key: state.supa_anon_key || "",
    ai_openai_key: state.ai_openai_key || "",
    ai_gemini_key: state.ai_gemini_key || "",
    ai_groq_key: state.ai_groq_key || "",
    accounts: Object.values(state.accounts || {}),
    meetings: Object.values(state.meetings || {}),
    updated_at: state.updated_at,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const state = readSyncState();

    if (body.supa_url && !body.supa_url.includes("placeholder")) {
      state.supa_url = body.supa_url.trim();
    }
    if (body.supa_anon_key && !body.supa_anon_key.includes("placeholder")) {
      state.supa_anon_key = body.supa_anon_key.trim();
    }
    if (body.ai_openai_key && !body.ai_openai_key.includes("placeholder")) {
      state.ai_openai_key = body.ai_openai_key.trim();
    }
    if (body.ai_gemini_key && !body.ai_gemini_key.includes("placeholder")) {
      state.ai_gemini_key = body.ai_gemini_key.trim();
    }
    if (body.ai_groq_key && !body.ai_groq_key.includes("placeholder")) {
      state.ai_groq_key = body.ai_groq_key.trim();
    }

    if (body.account && body.account.email) {
      const cleanEmail = body.account.email.trim().toLowerCase();
      const existingAcc = state.accounts[cleanEmail];
      const autoDefaultName = cleanEmail
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (l: string) => l.toUpperCase());

      // Preservar o nome personalizado (ex: "miguel") sobre o nome automático derivado do email
      const bestName =
        existingAcc?.name && existingAcc.name !== autoDefaultName && body.account.name === autoDefaultName
          ? existingAcc.name
          : body.account.name || existingAcc?.name || cleanEmail.split("@")[0];

      state.accounts[cleanEmail] = {
        ...(existingAcc || {}),
        ...body.account,
        name: bestName,
        email: cleanEmail,
      };
    }

    if (Array.isArray(body.accounts)) {
      for (const acc of body.accounts) {
        if (acc && acc.email) {
          const cleanEmail = acc.email.trim().toLowerCase();
          const existingAcc = state.accounts[cleanEmail];
          const autoDefaultName = cleanEmail
            .split("@")[0]
            .replace(/[._-]+/g, " ")
            .replace(/\b\w/g, (l: string) => l.toUpperCase());

          const bestName =
            existingAcc?.name && existingAcc.name !== autoDefaultName && acc.name === autoDefaultName
              ? existingAcc.name
              : acc.name || existingAcc?.name || cleanEmail.split("@")[0];

          state.accounts[cleanEmail] = {
            ...(existingAcc || {}),
            ...acc,
            name: bestName,
            email: cleanEmail,
          };
        }
      }
    }

    if (Array.isArray(body.meetings)) {
      for (const m of body.meetings) {
        if (m?.meeting?.id && m?.meeting?.title) {
          state.meetings[m.meeting.id] = m;
        }
      }
    }

    if (body.deletedMeetingId) {
      delete state.meetings[body.deletedMeetingId];
    }

    if (body.chunk && body.chunk.id) {
      if (!state.chunks) state.chunks = {};
      const chunkId = String(body.chunk.id);
      const alreadyExists = Boolean(state.chunks[chunkId]);
      if (!alreadyExists) {
        state.chunks[chunkId] = {
          id: chunkId,
          sessionId: body.chunk.sessionId,
          sequence: body.chunk.sequence,
          mimeType: body.chunk.mimeType || "audio/webm",
          sizeBytes: body.chunk.sizeBytes || 0,
          createdAt: body.chunk.createdAt || Date.now(),
          syncedAt: new Date().toISOString(),
        };
      }
      state.updated_at = new Date().toISOString();
      writeSyncState(state);
      return NextResponse.json({
        ok: true,
        chunkId,
        deduplicated: alreadyExists,
        syncedAt: state.updated_at,
      });
    }

    state.updated_at = new Date().toISOString();
    writeSyncState(state);

    return NextResponse.json({
      ok: true,
      accounts: Object.values(state.accounts),
      meetings: Object.values(state.meetings),
      supa_url: state.supa_url,
      supa_anon_key: state.supa_anon_key,
      ai_openai_key: state.ai_openai_key,
      ai_gemini_key: state.ai_gemini_key,
      ai_groq_key: state.ai_groq_key,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro no sync" }, { status: 400 });
  }
}
