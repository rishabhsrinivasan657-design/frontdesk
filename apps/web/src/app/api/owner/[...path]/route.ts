import type { NextRequest } from "next/server";
import { API_URL } from "@/lib/owner-api";

/** Browser → api headers. Never X-Forwarded-For: Next keeps a client-sent one, so it's spoofable. */
const REQUEST_HEADERS = ["cookie", "content-type", "origin", "accept"];
const RESPONSE_HEADERS = ["content-type", "cache-control", "x-accel-buffering"];

/**
 * Same-origin pass-through to the api's `/owner/*`, so the session cookie stays first-party and
 * the live feed (SSE) streams straight through. The api does all the auth.
 */
async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  if (path.some((p) => p === "." || p === ".." || p === "")) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const url = `${API_URL}/owner/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      redirect: "manual",
      cache: "no-store",
      // The api stops streaming when the owner's tab goes away.
      signal: req.signal,
      ...(req.method === "POST" ? { body: await req.text() } : {}),
    });
  } catch {
    return Response.json({ error: "api_unreachable" }, { status: 502 });
  }
  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const dynamic = "force-dynamic";
export { forward as GET, forward as POST };
