"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TurnstileTokens, loadTurnstile } from "./turnstile";

/**
 * The bot check before a chat starts (M10). Returns the element to render the widget into and a
 * stable `botToken` for the socket, or no `botToken` when the site has no Turnstile key.
 */
export function useTurnstile(siteKey: string | undefined) {
  const el = useRef<HTMLDivElement>(null);
  const tokens = useRef<Promise<TurnstileTokens> | undefined>(undefined);
  const resolveTokens = useRef<((t: TurnstileTokens) => void) | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  if (siteKey && !tokens.current) {
    tokens.current = new Promise((resolve) => (resolveTokens.current = resolve));
  }

  useEffect(() => {
    if (!siteKey || !el.current) return;
    const target = el.current;
    loadTurnstile()
      .then((api) => resolveTokens.current?.(new TurnstileTokens(api, target, siteKey)))
      .catch(() => setFailed(true));
  }, [siteKey]);

  const botToken = useCallback(async () => (await tokens.current!).next(), []);
  return { el, botToken: siteKey ? botToken : undefined, failed };
}
