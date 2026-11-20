export type OpenAIHealth = "missing" | "ready" | "rejected" | "permission" | "quota" | "limited" | "unverified";

const changes = new Set<(key: string, state: OpenAIHealth) => void>();

export function subscribeOpenAIHealth(listener: (key: string, state: OpenAIHealth) => void) {
  changes.add(listener);
  return () => { changes.delete(listener); };
}

async function classify(response: Response): Promise<OpenAIHealth> {
  if (response.ok) return "ready";
  if (response.status === 401) return "rejected";
  if (response.status === 403 || response.status === 404) return "permission";
  if (response.status === 429) {
    const data = await response.clone().json().catch(() => null);
    return ["insufficient_quota", "billing_hard_limit_reached"].includes(data?.error?.code) ? "quota" : "limited";
  }
  return "unverified";
}

export async function verifyOpenAITranscriptionKey(key: string, signal?: AbortSignal): Promise<OpenAIHealth> {
  if (!key) return "missing";
  try {
    const response = await fetch("https://api.openai.com/v1/models/whisper-1", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(8000),
    });
    return classify(response);
  } catch {
    return "unverified";
  }
}

export async function fetchOpenAI(url: string, options: RequestInit): Promise<Response> {
  const response = await fetch(url, options);
  const token = new Headers(options.headers).get("Authorization");
  if (typeof window !== "undefined" && token?.startsWith("Bearer ")) {
    const isTranscription = url.endsWith("/audio/transcriptions");
    if ([401, 403, 429].includes(response.status) || (isTranscription && (response.ok || response.status === 404))) {
      const state = await classify(response);
      for (const notify of changes) notify(token.slice(7), state);
    }
  }
  return response;
}
