import type { Latency } from "@/chat/state";

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The last turn's speed: first reply as the browser saw it, and the server's whole turn. */
export function LatencyBadge({ latency }: { latency: Latency }) {
  const parts = [
    ...(latency.firstReplyMs !== undefined
      ? [`first reply ${formatMs(latency.firstReplyMs)}`]
      : []),
    `total ${formatMs(latency.totalMs)}`,
  ];
  return (
    <span data-testid="latency" className="text-xs text-muted-foreground tabular-nums">
      {parts.join(" · ")}
    </span>
  );
}
