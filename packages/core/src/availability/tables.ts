import type { BusinessConfig } from "../config/schema.js";

export interface Table {
  id: string;
  size: number;
}

/** Physical tables, smallest first, with stable ids `t${size}-${n}` (n from 1). */
export function tablesFromConfig(config: BusinessConfig): Table[] {
  return [...config.seating.tables]
    .sort((a, b) => a.size - b.size)
    .flatMap(({ size, count }) =>
      Array.from({ length: count }, (_, i) => ({ id: `t${size}-${i + 1}`, size })),
    );
}

/**
 * The largest party the agent may seat: the policy ceiling, capped by the largest table, since
 * tables are never combined in v1 (spec §5). Above it the agent hands off (`party_too_large`).
 */
export function agentPartyLimit(config: BusinessConfig): number {
  const largest = Math.max(...config.seating.tables.map((t) => t.size));
  return Math.min(config.policies.maxPartyForAgent, largest);
}

export function holdMinutesFor(config: BusinessConfig, partySize: number): number {
  const { holdMinutes } = config.seating;
  return partySize >= 5 ? holdMinutes.partyOf5Plus : holdMinutes.default;
}

/** A Calendar reservation names a table the config doesn't define, so its seat can't be accounted for. */
export class UnknownTableError extends Error {
  override name = "UnknownTableError";

  constructor(
    readonly reservationId: string,
    readonly tableId: string,
  ) {
    super(
      `Reservation ${reservationId} is on table ${tableId}, which the business config doesn't define`,
    );
  }
}
