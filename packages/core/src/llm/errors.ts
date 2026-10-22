export type LLMErrorCode =
  | "rate_limited"
  | "upstream"
  | "spend_cap"
  | "invalid_output"
  | "replay_miss"
  | "stale_recording"
  | "config";

export interface LLMErrorOptions {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

/** Every failure the LLM layer surfaces to the agent loop. Retryable means HTTP 429 or 5xx. */
export class LLMError extends Error {
  override name = "LLMError";
  readonly code: LLMErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(code: LLMErrorCode, message: string, options: LLMErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable =
      options.status !== undefined && (options.status === 429 || options.status >= 500);
  }
}
