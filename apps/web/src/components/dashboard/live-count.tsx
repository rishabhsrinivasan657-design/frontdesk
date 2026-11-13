"use client";

import { useEffect, useState } from "react";
import { LIVE_COUNT_EVENT } from "./live-board";

/** The "Live now" tile: follows the Live board on the same page, starting from the snapshot. */
export function LiveCount({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    const on = (e: Event) => setCount((e as CustomEvent<number>).detail);
    window.addEventListener(LIVE_COUNT_EVENT, on);
    return () => window.removeEventListener(LIVE_COUNT_EVENT, on);
  }, []);
  return (
    <a
      href="#live"
      data-testid="kpi-live"
      className="rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:bg-muted/40"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <span
          aria-hidden
          className={
            count > 0
              ? "size-2 animate-pulse rounded-full bg-success"
              : "size-2 rounded-full bg-border"
          }
        />
        Live now
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{count}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {count === 1 ? "guest talking to Front Desk" : "guests talking to Front Desk"}
      </p>
    </a>
  );
}
