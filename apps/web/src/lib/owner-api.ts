import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

/** The api, server to server (never exposed to the browser). */
export const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
export const OWNER_COOKIE = "fd_owner";

/**
 * GETs an owner api path for a server component, with the owner's session cookie.
 * No session → login; unknown id → 404 page.
 */
export async function ownerFetch<T>(path: string): Promise<T> {
  const session = (await cookies()).get(OWNER_COOKIE)?.value;
  if (!session) redirect("/login");
  const res = await fetch(`${API_URL}/owner${path}`, {
    headers: { cookie: `${OWNER_COOKIE}=${session}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`owner api ${path.split("?")[0]} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Like ownerFetch, but a 503 (a dependency such as Calendar is down) is `null`, not a crash. */
export async function ownerFetchUnlessDown<T>(path: string): Promise<T | null> {
  const session = (await cookies()).get(OWNER_COOKIE)?.value;
  if (!session) redirect("/login");
  const res = await fetch(`${API_URL}/owner${path}`, {
    headers: { cookie: `${OWNER_COOKIE}=${session}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (res.status === 503) return null;
  if (!res.ok) throw new Error(`owner api ${path.split("?")[0]} answered ${res.status}`);
  return (await res.json()) as T;
}
