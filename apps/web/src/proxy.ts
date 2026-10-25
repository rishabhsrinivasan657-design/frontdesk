import { type NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

/**
 * Every /dashboard page needs the owner's session (spec §10). The api is asked, so a logged-out
 * or expired cookie is caught here, before anything renders. The api checks again on every call.
 */
export async function proxy(request: NextRequest) {
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  const session = request.cookies.get("fd_owner")?.value;
  if (!session) return NextResponse.redirect(login);
  try {
    const me = await fetch(`${API_URL}/owner/me`, {
      headers: { cookie: `fd_owner=${session}` },
      cache: "no-store",
    });
    if (me.ok) return NextResponse.next();
  } catch {
    // The api is down: the login page says so.
  }
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/dashboard", "/dashboard/:path*"] };
