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
  updated_at: string;
}

const TMP_FILE = path.join("/tmp", "marcameet_cloud_sync_v1.json");

declare global {
  // eslint-disable-next-line no-var
  var __marcameetCloudSync: CloudSyncData | undefined;
}

function readSyncState(): CloudSyncData {
  if (globalThis.__marcameetCloudSync) {
    return globalThis.__marcameetCloudSync;
  }
  try {
    if (fs.existsSync(TMP_FILE)) {
      const raw = fs.readFileSync(TMP_FILE, "utf-8");
      const parsed = JSON.parse(raw) as CloudSyncData;
      globalThis.__marcameetCloudSync = parsed;
      return parsed;
    }
  } catch {}

  const initial: CloudSyncData = {
    supa_url: "https://xuooojiaslhwaejsgjxh.supabase.co",
    accounts: {},
    updated_at: new Date().toISOString(),
  };
  globalThis.__marcameetCloudSync = initial;
  return initial;
}

function writeSyncState(state: CloudSyncData) {
  globalThis.__marcameetCloudSync = state;
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
      state.accounts[cleanEmail] = {
        ...(state.accounts[cleanEmail] || {}),
        ...body.account,
        email: cleanEmail,
      };
    }

    if (Array.isArray(body.accounts)) {
      for (const acc of body.accounts) {
        if (acc && acc.email) {
          const cleanEmail = acc.email.trim().toLowerCase();
          state.accounts[cleanEmail] = {
            ...(state.accounts[cleanEmail] || {}),
            ...acc,
            email: cleanEmail,
          };
        }
      }
    }

    state.updated_at = new Date().toISOString();
    writeSyncState(state);

    return NextResponse.json({
      ok: true,
      accounts: Object.values(state.accounts),
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
