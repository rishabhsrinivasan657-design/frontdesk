import type { OwnerSessionStore } from "./session-store.js";

/** Everything the owner routes need. Absent when OWNER_EMAIL / OWNER_PASSWORD_HASH are unset. */
export interface OwnerContext {
  email: string;
  /** bcrypt hash of the owner's password (`pnpm owner:hash`). */
  passwordHash: string;
  sessions: OwnerSessionStore;
  sessionTtlMs: number;
  /** Adds `Secure` to the cookie (production, behind HTTPS). */
  secureCookie: boolean;
}
