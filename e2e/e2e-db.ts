/**
 * e2e gets its own database, reset and seeded on every run, so specs never depend on or leave
 * state in the developer's database (and CI and local runs start from the same data).
 */
const base = process.env.DATABASE_URL ?? "postgres://frontdesk:frontdesk@localhost:54320/frontdesk";
export const E2E_DATABASE_URL = Object.assign(new URL(base), {
  pathname: "/frontdesk_e2e",
}).toString();
export const ADMIN_DATABASE_URL = base;
/** The api's pinned clock in e2e; seeded demo dates follow it. */
export const E2E_NOW = "2026-11-04T14:00:00-05:00";
