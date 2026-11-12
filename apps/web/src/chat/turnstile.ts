/** The part of Cloudflare's `window.turnstile` we use (explicit rendering). */
export interface TurnstileApi {
  render(
    el: HTMLElement,
    o: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "timeout-callback"?: () => void;
      "unsupported-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ): string | undefined;
  reset(widgetId: string): void;
}

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Hands out Turnstile tokens one at a time (M10): each new chat session needs its own, since a
 * token is valid once. After a token is used the widget is reset to solve the next one.
 * A failed challenge is retried once; a second failure (or a browser Turnstile doesn't support)
 * rejects every `next()` and calls `onFailed`, so the page can say so instead of waiting forever.
 */
export class TurnstileTokens {
  private readonly widgetId: string | undefined;
  private ready: string | undefined;
  private waiting: { resolve: (token: string) => void; reject: (e: Error) => void } | undefined;
  private used = false;
  private failures = 0;
  private failed = false;

  constructor(
    private readonly api: TurnstileApi,
    el: HTMLElement,
    sitekey: string,
    private readonly onFailed?: () => void,
  ) {
    this.widgetId = api.render(el, {
      sitekey,
      callback: (token) => {
        this.failures = 0;
        if (this.waiting) {
          const { resolve } = this.waiting;
          this.waiting = undefined;
          resolve(token);
        } else {
          this.ready = token;
        }
      },
      "error-callback": () => this.failure(),
      "timeout-callback": () => this.failure(),
      "unsupported-callback": () => this.fail(),
      "expired-callback": () => (this.ready = undefined),
    });
  }

  next(): Promise<string> {
    if (this.failed) return Promise.reject(new Error("turnstile failed"));
    if (this.ready !== undefined) {
      const token = this.ready;
      this.ready = undefined;
      this.used = true;
      return Promise.resolve(token);
    }
    if (this.used && this.widgetId !== undefined) this.api.reset(this.widgetId);
    this.used = true;
    return new Promise((resolve, reject) => (this.waiting = { resolve, reject }));
  }

  private failure(): void {
    this.failures += 1;
    if (this.failures >= 2) this.fail();
    else if (this.widgetId !== undefined) this.api.reset(this.widgetId);
  }

  private fail(): void {
    if (this.failed) return;
    this.failed = true;
    this.ready = undefined;
    this.waiting?.reject(new Error("turnstile failed"));
    this.waiting = undefined;
    this.onFailed?.();
  }
}

/** Loads Cloudflare's script once per page. */
export function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () =>
      w.turnstile ? resolve(w.turnstile) : reject(new Error("turnstile missing")),
    );
    script.addEventListener("error", () => reject(new Error("turnstile failed to load")));
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}
