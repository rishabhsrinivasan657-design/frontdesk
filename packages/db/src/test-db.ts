/** Docker Compose defaults; CI overrides them with env (see .github/workflows/ci.yml). */
export const TEST_DATABASES = {
  live: process.env.DATABASE_URL ?? "postgres://frontdesk:frontdesk@localhost:54320/frontdesk",
  eval:
    process.env.EVAL_DATABASE_URL ??
    "postgres://frontdesk:frontdesk@localhost:54320/frontdesk_eval",
} as const;
