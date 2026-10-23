import { createHash } from "node:crypto";

/**
 * A short, stable tag for a session in logs. The session id itself is the caller's credential
 * for resuming a conversation, so it never goes in a log line.
 */
export function sessionTag(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 10);
}

/** An error's name and message, minus the query parameters (caller names, emails) Drizzle appends. */
export function safeError(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) return { name: "Error", message: "non-error thrown" };
  return { name: error.name, message: error.message.split(/\n\s*params:/)[0]!.slice(0, 500) };
}

/** The request as logged: method and path only, never the query string (it may hold a session id). */
export function safeRequest(req: { method: string; url: string }): { method: string; url: string } {
  return { method: req.method, url: req.url.split("?")[0]! };
}
