const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

interface GoogleishError {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  response?: { status?: unknown; data?: unknown };
}

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;

function statusOf(e: GoogleishError): number | undefined {
  const s = e.response?.status ?? e.status;
  return typeof s === "number" ? s : undefined;
}

/** Google's machine-readable reason ("notFound", "invalid_grant", "rateLimitExceeded"), never free text. */
function reasonOf(e: GoogleishError): string | undefined {
  const data = asObject(e.response?.data);
  if (typeof data?.error === "string") return data.error; // OAuth errors: { error: "invalid_grant" }
  const err = asObject(data?.error);
  const first = Array.isArray(err?.errors) ? asObject(err.errors[0]) : undefined;
  const reason = first?.reason ?? err?.status;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * A fresh, secret-free error for a failed Google call. googleapis errors carry the request
 * config (Authorization header, refresh token, client secret) and free-text messages, so
 * nothing from the original is copied except the status and Google's reason code, and the
 * original is not attached as `cause`.
 */
export function googleFailure(error: unknown, what: string): Error {
  const e = (asObject(error) ?? {}) as GoogleishError;
  const status = statusOf(e);
  const code = typeof e.code === "string" && NETWORK_CODES.has(e.code) ? e.code : undefined;
  const detail =
    status === undefined ? `network ${code ?? "error"}` : `${status} ${reasonOf(e) ?? ""}`;
  return new Error(`${what} failed: ${detail.trim()}`);
}

/** True for outages worth handing off on: network errors, timeouts, 429 and 5xx. */
export function isUnavailable(error: unknown): boolean {
  const e = (asObject(error) ?? {}) as GoogleishError;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) return true;
  const status = statusOf(e);
  return status !== undefined && (status === 429 || status >= 500);
}
