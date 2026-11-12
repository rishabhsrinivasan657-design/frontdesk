/**
 * The server half of the ElevenLabs comparison voice (spec §5.6), kept framework-free so it's easy
 * to test; `app/api/voice/tts/route.ts` is the Next.js route around it. The key never leaves the
 * server. The free plan has no card, so the worst case is running out of credits: we stop below
 * the free allowance and the browser falls back to Kokoro.
 */
export const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
/** Flash v2.5: ElevenLabs' lowest-latency model, and half the credits per character. */
export const MODEL = "eleven_flash_v2_5";
/** "Sarah", a premade voice every account has; ELEVENLABS_VOICE_ID picks another. */
export const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL";
/** A reply sentence is short; anything longer isn't ours. */
export const MAX_CHARS = 400;
/** Characters per month we allow by default, safely under the free plan (~20k on Flash). */
export const DEFAULT_MONTHLY_CHARS = 18_000;

/** Reads ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID and ELEVENLABS_MONTHLY_CHARS. */
export type TtsProxyEnv = Record<string, string | undefined>;

/** Characters used this month, per server instance (a restart forgets; the plan's own limit still holds). */
const used = new Map<string, number>();

export async function proxyTts(
  req: { text: unknown; origin: string | null; host: string | null },
  env: TtsProxyEnv,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Response> {
  const key = env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "off" }, { status: 404 });
  // Only our own page may spend the credits.
  if (!req.origin || !req.host || new URL(req.origin).host !== req.host) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const text = typeof req.text === "string" ? req.text.trim() : "";
  if (!text || text.length > MAX_CHARS)
    return Response.json({ error: "bad_text" }, { status: 400 });
  const month = now.toISOString().slice(0, 7);
  const cap = Number(env.ELEVENLABS_MONTHLY_CHARS) || DEFAULT_MONTHLY_CHARS;
  const so_far = used.get(month) ?? 0;
  if (so_far + text.length > cap) return Response.json({ error: "monthly_cap" }, { status: 429 });
  used.set(month, so_far + text.length);
  const voice = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const upstream = await fetchImpl(`${ELEVENLABS_URL}/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL }),
  }).catch(() => undefined);
  if (!upstream?.ok || !upstream.body) {
    // Out of credits, a bad key or a network error: the browser falls back to Kokoro.
    return Response.json({ error: "upstream", status: upstream?.status }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
}

/** Tests only. */
export function resetUsage(): void {
  used.clear();
}
