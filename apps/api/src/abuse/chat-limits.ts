import { keyTag, type WindowCounter } from "./window-counter.js";

/** Per-IP and per-session caps on the public chat (M10). A real booking takes ≤ 10 turns. */
export const DEFAULT_CHAT_LIMITS = {
  sessionsPerIpPerHour: 10,
  socketsPerIp: 3,
  turnsPerIpPerDay: 300,
  turnsPerSessionPerMinute: 8,
  turnsPerSession: 40,
};
export type ChatLimitConfig = typeof DEFAULT_CHAT_LIMITS;

export type ConnectVerdict = "ok" | "too_many_sessions" | "too_many_sockets";
export type TurnVerdict = "ok" | "slow_down" | "session_full" | "daily_limit";

/** What the server asks before opening a socket and before each caller turn. */
export interface ChatGuard {
  connect(ip: string): Promise<ConnectVerdict>;
  /** The socket admitted by `connect` closed. */
  release(ip: string): void;
  turn(ip: string, sessionId: string): Promise<TurnVerdict>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Counters live in Redis (they survive restarts); open sockets are counted in this process,
 * which is the only api process in the pilot (docs/deploy.md). Keys hold hashes, never raw values.
 */
export class ChatLimits implements ChatGuard {
  private readonly sockets = new Map<string, number>();

  constructor(
    private readonly counter: WindowCounter,
    private readonly limits: ChatLimitConfig = DEFAULT_CHAT_LIMITS,
  ) {}

  async connect(ip: string): Promise<ConnectVerdict> {
    const open = this.sockets.get(ip) ?? 0;
    if (open >= this.limits.socketsPerIp) return "too_many_sockets";
    const sessions = await this.counter.hit(`ip:${keyTag(ip)}:sessions`, HOUR);
    if (sessions > this.limits.sessionsPerIpPerHour) return "too_many_sessions";
    this.sockets.set(ip, open + 1);
    return "ok";
  }

  release(ip: string): void {
    const open = (this.sockets.get(ip) ?? 0) - 1;
    if (open > 0) this.sockets.set(ip, open);
    else this.sockets.delete(ip);
  }

  async turn(ip: string, sessionId: string): Promise<TurnVerdict> {
    const session = keyTag(sessionId);
    const total = await this.counter.hit(`s:${session}:total`, DAY);
    if (total > this.limits.turnsPerSession) return "session_full";
    const perMinute = await this.counter.hit(`s:${session}:minute`, MINUTE);
    if (perMinute > this.limits.turnsPerSessionPerMinute) return "slow_down";
    const daily = await this.counter.hit(`ip:${keyTag(ip)}:turns`, DAY);
    if (daily > this.limits.turnsPerIpPerDay) return "daily_limit";
    return "ok";
  }
}
