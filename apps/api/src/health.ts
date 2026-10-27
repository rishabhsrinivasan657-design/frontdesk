export type CheckName = "redis" | "postgres" | "google" | "worker";
export type Checks = Record<CheckName, () => Promise<boolean>>;
export interface Readiness {
  ok: boolean;
  checks: Record<CheckName, "ok" | "fail">;
}

/** The Google check refreshes an OAuth token: cached so the endpoint can't be used to hammer Google. */
const GOOGLE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 5000;

/**
 * `GET /health/ready` (M10). Each check answers ok/fail only: no error text, which could carry a
 * token or an address. A check that throws or takes longer than the timeout is a fail.
 */
export function readiness(
  checks: Checks,
  o: { now?: () => number; timeoutMs?: number } = {},
): () => Promise<Readiness> {
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  let google: { at: number; ok: boolean } | undefined;
  // One check in flight at a time: concurrent requests wait for it instead of each refreshing.
  let inFlight: Promise<boolean> | undefined;

  const run = async (check: () => Promise<boolean>): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>(
      (resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)),
    );
    try {
      return await Promise.race([check().catch(() => false), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  const googleCached = async (): Promise<boolean> => {
    if (google && now() - google.at < GOOGLE_TTL_MS) return google.ok;
    inFlight ??= run(checks.google).then((result) => {
      google = { at: now(), ok: result };
      inFlight = undefined;
      return result;
    });
    return inFlight;
  };

  return async () => {
    const [redis, postgres, g, worker] = await Promise.all([
      run(checks.redis),
      run(checks.postgres),
      googleCached(),
      run(checks.worker),
    ]);
    const label = (b: boolean): "ok" | "fail" => (b ? "ok" : "fail");
    return {
      ok: redis && postgres && g && worker,
      checks: {
        redis: label(redis),
        postgres: label(postgres),
        google: label(g),
        worker: label(worker),
      },
    };
  };
}
