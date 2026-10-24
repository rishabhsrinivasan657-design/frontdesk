import type { LLMChunk, LLMProvider, LLMRequest, Usage } from "@frontdesk/core";
import type { ZodType } from "zod";

export interface HedgeOptions {
  /** How long the primary gets alone before the backup starts too; 0 races both at once. */
  afterMs?: number;
}

/**
 * Hedged requests across two models (spec §8 latency). The free tier queues each model on
 * its own, so a call can wait 0.5 s or 30 s. Whichever model answers first wins, and if one
 * fails the other carries on. A stream only switches before its first chunk.
 *
 * Free tier only: the loser's tokens never reach the spend cap.
 */
export function withHedge(
  primary: LLMProvider,
  backup: LLMProvider,
  options: HedgeOptions = {},
): LLMProvider {
  const { afterMs = 0 } = options;

  /** The first arm to succeed; if both fail, the primary's error. */
  function race<T>(run: (p: LLMProvider) => Promise<T>, discard: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let running = 0;
      let backupStarted = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const errors = new Map<LLMProvider, unknown>();

      const launch = (provider: LLMProvider) => {
        running += 1;
        run(provider).then(
          (value) => {
            running -= 1;
            if (settled) return discard(value);
            settled = true;
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            running -= 1;
            errors.set(provider, error);
            if (settled) return;
            if (!backupStarted) return startBackup();
            if (running === 0) {
              settled = true;
              // Rethrows the provider's own error unchanged, whatever its type.
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              reject(errors.has(primary) ? errors.get(primary) : error);
            }
          },
        );
      };
      const startBackup = () => {
        if (backupStarted) return;
        backupStarted = true;
        clearTimeout(timer);
        launch(backup);
      };

      launch(primary);
      if (afterMs <= 0) startBackup();
      else timer = setTimeout(startBackup, afterMs);
    });
  }

  return {
    model: primary.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const { it, first } = await race(
        async (provider) => {
          const it = provider.stream(req)[Symbol.asyncIterator]();
          return { it, first: await it.next() };
        },
        // The loser stops at its first chunk; return() closes its connection.
        ({ it }) => void Promise.resolve(it.return?.()).catch(() => undefined),
      );
      if (first.done) return;
      yield first.value;
      yield* { [Symbol.asyncIterator]: () => it };
    },
    generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      return race(
        (provider) => provider.generate(req, schema),
        () => undefined,
      );
    },
  };
}
