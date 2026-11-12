import type { NextRequest } from "next/server";
import { proxyTts } from "@/voice/elevenlabs-proxy";

/** POST `{ text }` → audio/mpeg from ElevenLabs (the `?voice=elevenlabs` comparison voice). */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  return proxyTts(
    { text: body.text, origin: req.headers.get("origin"), host: req.headers.get("host") },
    process.env,
  );
}
