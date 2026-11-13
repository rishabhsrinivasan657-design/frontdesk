import type { ChatState } from "./state";

/**
 * Render's free plan puts the web and api services to sleep after 15 idle minutes. They used to
 * wake one after the other: the page first, then the api only when the chat socket reached it.
 * Pinging the api's /health as early as possible wakes both at once.
 */

/** After this long without a connection, tell the guest the receptionist is waking up. */
export const WAKE_HINT_AFTER_MS = 3_000;
/** A cold start is over by now; after this, "unreachable" means unreachable. */
export const WAKE_GIVE_UP_MS = 120_000;

/** `wss://host/ws` (or `https://host`) → `https://host/health`. */
export function healthUrlFor(address: string): string | undefined {
  try {
    const url = new URL(address);
    url.protocol = url.protocol.replace(/^ws/, "http");
    url.pathname = "/health";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Fire-and-forget: starts waking the api. Never throws, never blocks. */
export function wakeApi(
  address: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<unknown> = fetch,
): void {
  const url = healthUrlFor(address);
  if (!url) return;
  try {
    // no-cors: we only need the request to arrive, not to read the answer.
    void fetchImpl(url, { mode: "no-cors", cache: "no-store" }).catch(() => {});
  } catch {
    // A ping is best effort.
  }
}

/** Whether the guest should read "waking up" instead of a bare "Connecting…". */
export function wakingUp(
  status: ChatState["status"],
  everOpened: boolean,
  elapsedMs: number,
): boolean {
  if (everOpened || elapsedMs < WAKE_HINT_AFTER_MS) return false;
  if (status === "connecting" || status === "reconnecting") return true;
  return status === "unreachable" && elapsedMs < WAKE_GIVE_UP_MS;
}
