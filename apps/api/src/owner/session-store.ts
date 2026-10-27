import { randomBytes } from "node:crypto";
import { createKeyTag, type KeyTag } from "@frontdesk/worker";
import type { Redis } from "ioredis";

/** Failed logins allowed per IP in one window before 429. */
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
/**
 * Login attempts allowed from everywhere together per hour (M10): a backstop for guessing
 * spread across many addresses, which a per-address limit can't see.
 */
export const MAX_LOGIN_ATTEMPTS_PER_HOUR = 50;
const GLOBAL_WINDOW_MS = 3_600_000;

/** Owner sessions: random ids the server remembers, so logout and expiry are real. */
export interface OwnerSessionStore {
  create(): Promise<string>;
  valid(id: string): Promise<boolean>;
  destroy(id: string): Promise<void>;
  /**
   * Counts a login attempt from `ip` before the password is checked and returns the count in
   * the current window, atomically: parallel guesses each get their own number.
   */
  attempt(ip: string): Promise<number>;
  /** A correct password: earlier mistakes no longer count. */
  clearAttempts(ip: string): Promise<void>;
  /** Counts a login attempt from anywhere and returns the count in the current hour. */
  attemptAnywhere(): Promise<number>;
}

/** 32 random bytes, base64url: 43 characters, unguessable. */
export const newSessionId = (): string => randomBytes(32).toString("base64url");

/** Only ids we could have issued reach Redis (no key injection, no huge keys). */
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
export const isSessionIdShape = (id: string): boolean => SESSION_ID.test(id);

export class RedisOwnerSessionStore implements OwnerSessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs: number,
    /** Failure keys hold a keyed hash of the address, never the address (M10). */
    private readonly tag: KeyTag = createKeyTag("dev"),
  ) {}

  async create(): Promise<string> {
    const id = newSessionId();
    await this.redis.set(`owner:sess:${id}`, "1", "PX", this.ttlMs);
    return id;
  }

  async valid(id: string): Promise<boolean> {
    if (!isSessionIdShape(id)) return false;
    return (await this.redis.exists(`owner:sess:${id}`)) === 1;
  }

  async destroy(id: string): Promise<void> {
    if (isSessionIdShape(id)) await this.redis.del(`owner:sess:${id}`);
  }

  private async count(key: string, windowMs: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.pexpire(key, windowMs);
    return n;
  }

  attempt(ip: string): Promise<number> {
    return this.count(`owner:fail:${this.tag(ip)}`, LOGIN_FAILURE_WINDOW_MS);
  }

  async clearAttempts(ip: string): Promise<void> {
    await this.redis.del(`owner:fail:${this.tag(ip)}`);
  }

  attemptAnywhere(): Promise<number> {
    return this.count("owner:attempts:all", GLOBAL_WINDOW_MS);
  }
}

/** The same contract in memory, for unit tests. */
export class InMemoryOwnerSessionStore implements OwnerSessionStore {
  private readonly sessions = new Map<string, number>();
  private readonly fails = new Map<string, { n: number; until: number }>();
  private anywhere = { n: 0, until: 0 };

  constructor(
    private readonly ttlMs = 12 * 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  create(): Promise<string> {
    const id = newSessionId();
    this.sessions.set(id, this.now() + this.ttlMs);
    return Promise.resolve(id);
  }

  valid(id: string): Promise<boolean> {
    const until = this.sessions.get(id);
    return Promise.resolve(until !== undefined && until > this.now());
  }

  destroy(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }

  attempt(ip: string): Promise<number> {
    const f = this.fails.get(ip);
    const current =
      f && f.until > this.now() ? f : { n: 0, until: this.now() + LOGIN_FAILURE_WINDOW_MS };
    const next = { n: current.n + 1, until: current.until };
    this.fails.set(ip, next);
    return Promise.resolve(next.n);
  }

  clearAttempts(ip: string): Promise<void> {
    this.fails.delete(ip);
    return Promise.resolve();
  }

  attemptAnywhere(): Promise<number> {
    if (this.anywhere.until <= this.now()) {
      this.anywhere = { n: 0, until: this.now() + GLOBAL_WINDOW_MS };
    }
    this.anywhere.n += 1;
    return Promise.resolve(this.anywhere.n);
  }
}
