/** The part of Cloudflare's `window.turnstile` we use (explicit rendering). */
export interface TurnstileApi {
  render(
    el: HTMLElement,
    o: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void },
  ): string | undefined;
  reset(widgetId: string): void;
}

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Hands out Turnstile tokens one at a time (M10): each new chat session needs its own, since a
 * token is valid once. After a token is used the widget is reset to solve the next one.
 */
export class TurnstileTokens {
  private readonly widgetId: string | undefined;
  private ready: string | undefined;
  private waiting: ((token: string) => void) | undefined;
  private used = false;

  constructor(
    private readonly api: TurnstileApi,
    el: HTMLElement,
    sitekey: string,
  ) {
    this.widgetId = api.render(el, {
      sitekey,
      callback: (token) => {
        if (this.waiting) {
          const resolve = this.waiting;
          this.waiting = undefined;
          resolve(token);
        } else {
          this.ready = token;
        }
      },
    });
  }

  next(): Promise<string> {
    if (this.ready !== undefined) {
      const token = this.ready;
      this.ready = undefined;
      this.used = true;
      return Promise.resolve(token);
    }
    if (this.used && this.widgetId !== undefined) this.api.reset(this.widgetId);
    this.used = true;
    return new Promise((resolve) => (this.waiting = resolve));
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
