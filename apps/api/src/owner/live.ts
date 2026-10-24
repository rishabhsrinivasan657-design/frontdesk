import type { Clock, SessionStore } from "@frontdesk/core";
import type { SessionHub } from "../chat/hub.js";
import type { OwnerFeed } from "./feed.js";
import type { OwnerRouteSet } from "./plugin.js";

/** Keeps proxies and browsers from dropping a quiet stream. */
export const PING_MS = 15_000;

export interface LiveSession {
  sessionId: string;
  startedAt: string;
  turnCount: number;
  lastCallerText: string | null;
  lastAgentText: string | null;
  pending: { summary: string; expiresAt: string } | null;
  handedOff: boolean;
}

export interface OwnerLiveDeps {
  hub: SessionHub;
  sessions: SessionStore;
  clock: Clock;
  feed: OwnerFeed;
}

/** `GET /owner/live` (who is talking now) and `GET /owner/live/stream` (SSE of LiveEvents). */
export function ownerLiveRoutes(deps: OwnerLiveDeps): OwnerRouteSet {
  return (app) => {
    app.get("/live", async (): Promise<LiveSession[]> => {
      const now = deps.clock.now().getTime();
      const found = await Promise.all(
        deps.hub.activeSessions().map(async (sessionId): Promise<LiveSession | undefined> => {
          const session = await deps.sessions.load(sessionId);
          const pending = await deps.sessions.getPending(sessionId);
          const transcript = session?.transcript ?? [];
          const last = (role: "caller" | "agent") =>
            transcript.findLast((t) => t.role === role)?.text ?? null;
          return {
            sessionId,
            startedAt: session?.createdAt ?? new Date(now).toISOString(),
            turnCount: transcript.filter((t) => t.role === "caller").length,
            lastCallerText: last("caller"),
            lastAgentText: last("agent"),
            pending:
              pending && Date.parse(pending.expiresAt) > now
                ? { summary: pending.summary, expiresAt: pending.expiresAt }
                : null,
            handedOff: !!session?.handoff,
          };
        }),
      );
      return found
        .filter((s): s is LiveSession => s !== undefined)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    });

    app.get("/live/stream", (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Tells nginx-style proxies not to buffer the stream.
        "x-accel-buffering": "no",
      });
      res.write(": connected\n\n");
      const unsubscribe = deps.feed.subscribe((e) => {
        res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      });
      const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
      req.raw.on("close", () => {
        clearInterval(ping);
        unsubscribe();
      });
    });
  };
}
