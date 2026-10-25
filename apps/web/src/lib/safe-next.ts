const HOME = "/dashboard";

/**
 * Where to go after login. Only a dashboard path on this site: anything else (another host,
 * `//host`, a backslash trick, `..`) falls back to the dashboard, so `?next=` can't redirect
 * the owner off-site.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return HOME;
  let url: URL;
  try {
    url = new URL(next, "http://front.desk");
  } catch {
    return HOME;
  }
  if (url.origin !== "http://front.desk" || next.includes("/..")) return HOME;
  if (url.pathname !== HOME && !url.pathname.startsWith(`${HOME}/`)) return HOME;
  return next;
}
