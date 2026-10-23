import type { PendingAction, SessionState, SessionStore } from "@frontdesk/core";
import type { Redis } from "ioredis";
import { decode, encode } from "./codec.js";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** A pending key outlives its expiresAt so the loop can still tell the caller it timed out. */
export const PENDING_GRACE_MS = 60_000;

export interface RedisSessionStoreOptions {
  prefix?: string;
  sessionTtlMs?: number;
  pendingGraceMs?: number;
  now?: () => number;
}

/** Removes and returns the value only if its decoded id matches ARGV[1]. */
const TAKE_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return false end
if cjson.decode(v).id ~= ARGV[1] then return false end
redis.call('DEL', KEYS[1])
return v
`;

/** Session state and the one pending action per session, in Redis (spec §3, §11). */
export class RedisSessionStore implements SessionStore {
  private readonly prefix: string;
  private readonly sessionTtlMs: number;
  private readonly pendingGraceMs: number;
  private readonly now: () => number;

  constructor(
    private readonly redis: Redis,
    opts: RedisSessionStoreOptions = {},
  ) {
    this.prefix = opts.prefix ?? "fd:";
    this.sessionTtlMs = opts.sessionTtlMs ?? SESSION_TTL_MS;
    this.pendingGraceMs = opts.pendingGraceMs ?? PENDING_GRACE_MS;
    this.now = opts.now ?? Date.now;
  }

  async load(id: string): Promise<SessionState | undefined> {
    const text = await this.redis.get(this.sessionKey(id));
    return text === null ? undefined : decode<SessionState>(text);
  }

  async save(state: SessionState): Promise<void> {
    await this.redis.set(this.sessionKey(state.id), encode(state), "PX", this.sessionTtlMs);
  }

  async putPending(action: PendingAction): Promise<void> {
    const ttl = Math.max(1, Date.parse(action.expiresAt) - this.now() + this.pendingGraceMs);
    await this.redis.set(this.pendingKey(action.sessionId), encode(action), "PX", ttl);
  }

  async getPending(sessionId: string): Promise<PendingAction | undefined> {
    const text = await this.redis.get(this.pendingKey(sessionId));
    return text === null ? undefined : decode<PendingAction>(text);
  }

  async takePending(sessionId: string, actionId: string): Promise<PendingAction | undefined> {
    const text = (await this.redis.eval(TAKE_SCRIPT, 1, this.pendingKey(sessionId), actionId)) as
      string | null;
    return text ? decode<PendingAction>(text) : undefined;
  }

  async clearPending(sessionId: string): Promise<PendingAction | undefined> {
    const text = await this.redis.getdel(this.pendingKey(sessionId));
    return text === null ? undefined : decode<PendingAction>(text);
  }

  private sessionKey(id: string): string {
    return `${this.prefix}session:${id}`;
  }

  private pendingKey(sessionId: string): string {
    return `${this.prefix}pending:${sessionId}`;
  }
}
