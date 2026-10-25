import type { LiveEvent, LiveSession } from "./types";

/** One card on the Live board: the api's snapshot plus what the stream has said since. */
export interface LiveCard extends LiveSession {
  lastFirstOutputMs?: number | null;
  lastAction?: "executed" | "failed" | "voided";
}

const blank = (sessionId: string, startedAt: string): LiveCard => ({
  sessionId,
  startedAt,
  turnCount: 0,
  lastCallerText: null,
  lastAgentText: null,
  pending: null,
  handedOff: false,
});

const newestFirst = (cards: LiveCard[]) =>
  [...cards].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

/** Applies one live event. Cards it doesn't touch keep their identity (cheap re-renders). */
export function applyLiveEvent(cards: LiveCard[], e: LiveEvent): LiveCard[] {
  if (e.type === "session_closed") return cards.filter((c) => c.sessionId !== e.sessionId);
  const existing = cards.find((c) => c.sessionId === e.sessionId);
  if (e.type === "session_open") {
    return existing ? cards : newestFirst([...cards, blank(e.sessionId, e.at)]);
  }
  const card = existing ?? blank(e.sessionId, e.type === "turn" ? e.at : new Date().toISOString());
  let next: LiveCard;
  switch (e.type) {
    case "turn":
      next = {
        ...card,
        turnCount: card.turnCount + 1,
        lastCallerText: e.callerText,
        lastAgentText: e.agentText,
        lastFirstOutputMs: e.firstOutputMs,
      };
      break;
    case "pending":
      next = {
        ...card,
        pending: { summary: e.summary, expiresAt: e.expiresAt },
        lastAction: undefined,
      };
      break;
    case "pending_cleared":
      next = { ...card, pending: null, lastAction: e.status };
      break;
    case "handoff":
      next = { ...card, handedOff: true, pending: null };
      break;
  }
  return existing ? cards.map((c) => (c === existing ? next : c)) : newestFirst([...cards, next]);
}
