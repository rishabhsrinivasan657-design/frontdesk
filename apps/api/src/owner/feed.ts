/** What the owner's Live view hears about, as it happens (spec §10). */
export type LiveEvent =
  | { type: "session_open" | "session_closed"; sessionId: string; at: string }
  | {
      type: "turn";
      sessionId: string;
      turnId: string;
      callerText: string;
      agentText: string;
      firstOutputMs: number | null;
      flags: string[];
      at: string;
    }
  | { type: "pending"; sessionId: string; summary: string; expiresAt: string }
  | { type: "pending_cleared"; sessionId: string; status: "executed" | "failed" | "voided" }
  | { type: "handoff"; sessionId: string; reason: string };

/** In-process fan-out from chat sockets to owner live streams (one api process). */
export class OwnerFeed {
  private readonly subscribers = new Set<(e: LiveEvent) => void>();

  subscribe(fn: (e: LiveEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Never throws: a broken owner stream must not break a caller's turn. */
  publish(event: LiveEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // The subscriber's own problem; the next one still hears it.
      }
    }
  }
}
