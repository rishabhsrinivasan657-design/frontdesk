import { isIPv6 } from "node:net";
import { createKeyTag, type KeyTag } from "@frontdesk/worker";
import type { WindowCounter } from "./window-counter.js";

/**
 * Caps on the public chat (M10). A real booking takes ≤ 10 turns, and a turn can make 2 model
 * calls, so one IP stays under a quarter of the free tier's 500 requests a day and everyone
 * together stays under all of it.
 */
export const DEFAULT_CHAT_LIMITS = {
  sessionsPerIpPerHour: 10,
  socketsPerIp: 3,
  turnsPerIpPerDay: 60,
  turnsPerSessionPerMinute: 8,
  turnsPerSession: 40,
  turnsPerDay: 200,
};
export type ChatLimitConfig = typeof DEFAULT_CHAT_LIMITS;

export type ConnectVerdict = "ok" | "too_many_sessions" | "too_many_sockets";
export type TurnVerdict = "ok" | "slow_down" | "session_full" | "daily_limit" | "busy_today";

/**
 * Who a limit counts: an IPv4 address, or an IPv6 /64 (one host can hold a whole /64, so
 * counting single IPv6 addresses would let it rotate past every limit).
 */
export function clientKey(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1]!;
  if (!isIPv6(ip)) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

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
/** Outlives any session (sessions slide 24 h per save), so a full session never refills. */
const SESSION_LIFETIME = 30 * DAY;

/**
 * Counters live in Redis (they survive restarts); open sockets are counted in this process,
 * which is the only api process in the pilot (docs/deploy.md). Keys hold hashes, never raw values.
 */
export class ChatLimits implements ChatGuard {
  private readonly sockets = new Map<string, number>();

  constructor(
    private readonly counter: WindowCounter,
    private readonly limits: ChatLimitConfig = DEFAULT_CHAT_LIMITS,
    private readonly tag: KeyTag = createKeyTag("dev"),
  ) {}

  /** Takes a socket slot before any await, so parallel connects can't all see a free one. */
  async connect(ip: string): Promise<ConnectVerdict> {
    const who = clientKey(ip);
    const open = this.sockets.get(who) ?? 0;
    if (open >= this.limits.socketsPerIp) return "too_many_sockets";
    this.sockets.set(who, open + 1);
    try {
      const sessions = await this.counter.hit(`ip:${this.tag(who)}:sessions`, HOUR);
      if (sessions > this.limits.sessionsPerIpPerHour) {
        this.release(ip);
        return "too_many_sessions";
      }
      return "ok";
    } catch (error) {
      this.release(ip);
      throw error;
    }
  }

  release(ip: string): void {
    const who = clientKey(ip);
    const open = (this.sockets.get(who) ?? 0) - 1;
    if (open > 0) this.sockets.set(who, open);
    else this.sockets.delete(who);
  }

  async turn(ip: string, sessionId: string): Promise<TurnVerdict> {
    const session = this.tag(sessionId);
    const total = await this.counter.hit(`s:${session}:total`, SESSION_LIFETIME);
    if (total > this.limits.turnsPerSession) return "session_full";
    const perMinute = await this.counter.hit(`s:${session}:minute`, MINUTE);
    if (perMinute > this.limits.turnsPerSessionPerMinute) return "slow_down";
    const daily = await this.counter.hit(`ip:${this.tag(clientKey(ip))}:turns`, DAY);
    if (daily > this.limits.turnsPerIpPerDay) return "daily_limit";
    const everyone = await this.counter.hit("all:turns", DAY);
    if (everyone > this.limits.turnsPerDay) return "busy_today";
    return "ok";
  }
}
