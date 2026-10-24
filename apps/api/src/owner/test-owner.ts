import type { OwnerContext } from "./context.js";
import { InMemoryOwnerSessionStore } from "./session-store.js";

/** An owner context with in-memory sessions. Tests only. */
export function testOwner(
  o: Partial<OwnerContext> & Pick<OwnerContext, "email" | "passwordHash">,
): OwnerContext {
  return {
    sessions: new InMemoryOwnerSessionStore(),
    sessionTtlMs: 12 * 3_600_000,
    secureCookie: false,
    ...o,
  };
}
