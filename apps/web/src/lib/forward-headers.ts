/** Browser → api headers. */
const REQUEST_HEADERS = ["cookie", "content-type", "origin", "accept"];

/**
 * The headers the owner proxy forwards to the api. X-Forwarded-For only with
 * TRUST_FORWARDED_FOR=1 (production behind Caddy, M10), and then only its last entry: Caddy
 * appends the real client address, while anything before it came from the browser and is
 * spoofable. Without it, the api's per-IP login limit would see every owner as this server.
 */
export function forwardHeaders(
  incoming: Headers,
  env: Record<string, string | undefined>,
): Headers {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  if (env.TRUST_FORWARDED_FOR === "1") {
    const client = incoming.get("x-forwarded-for")?.split(",").pop()?.trim();
    if (client) headers.set("x-forwarded-for", client);
  }
  return headers;
}
