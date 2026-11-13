/** Asks whether a browser passed the bot challenge before it may start a chat (M10). */
export interface BotCheck {
  verify(token: string, ip: string): Promise<boolean>;
}

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Turnstile tokens are up to 2048 characters. */
const MAX_TOKEN = 2048;
const TIMEOUT_MS = 5000;

/**
 * Cloudflare Turnstile's server-side check. A token is valid once, for 5 minutes, and only for
 * the hostnames we serve; anything unexpected (network, status, shape) counts as a failure.
 */
export class TurnstileBotCheck implements BotCheck {
  constructor(
    private readonly o: {
      secret: string;
      hostnames: string[];
      fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    },
  ) {}

  async verify(token: string, ip: string): Promise<boolean> {
    if (!token || token.length > MAX_TOKEN) return false;
    const fetchImpl = this.o.fetch ?? fetch;
    try {
      const res = await fetchImpl(SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: this.o.secret,
          response: token,
          remoteip: ip,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`Turnstile siteverify answered HTTP ${res.status}`);
        return false;
      }
      const body = (await res.json()) as {
        success?: unknown;
        hostname?: unknown;
        "error-codes"?: unknown;
      };
      if (body.success !== true) {
        console.warn(`Turnstile rejected the token: ${JSON.stringify(body["error-codes"] ?? [])}`);
        return false;
      }
      if (typeof body.hostname !== "string" || !this.o.hostnames.includes(body.hostname)) {
        console.warn(`Turnstile token is for ${String(body.hostname)}, not TURNSTILE_HOSTNAMES`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn(`Turnstile siteverify failed: ${error instanceof Error ? error.name : "error"}`);
      return false;
    }
  }
}
