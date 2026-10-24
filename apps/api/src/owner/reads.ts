import {
  type BookingRow,
  type ConversationDetail,
  type ConversationSummary,
  type Db,
  type HandoffRow,
  type MetricsReport,
  type OwnerSource,
  PgHandoffQueue,
  getConversation,
  listBookings,
  listConversations,
  listHandoffs,
  metrics,
} from "@frontdesk/db";

/** What the owner routes read and write, so they can be tested without Postgres. */
export interface OwnerReads {
  listConversations: (o: {
    source: OwnerSource;
    q?: string;
    before?: string;
    limit: number;
  }) => Promise<ConversationSummary[]>;
  getConversation: (id: string) => Promise<ConversationDetail | null>;
  listBookings: (o: { source: OwnerSource }) => Promise<BookingRow[]>;
  listHandoffs: (o: { source: OwnerSource; status: "open" | "resolved" }) => Promise<HandoffRow[]>;
  resolveHandoff: (
    id: string,
    notes: string,
    at: string,
  ) => Promise<"resolved" | "not_found" | "already_resolved">;
  metrics: (o: { source: OwnerSource; days: number }) => Promise<MetricsReport>;
}

/** The Postgres read model from `@frontdesk/db`; days are in the business timezone. */
export function pgOwnerReads(db: Db, o: { timezone: string; now: () => Date }): OwnerReads {
  const queue = new PgHandoffQueue(db);
  return {
    listConversations: (q) => listConversations(db, q),
    getConversation: (id) => getConversation(db, id),
    listBookings: (q) => listBookings(db, q),
    listHandoffs: (q) => listHandoffs(db, q),
    resolveHandoff: (id, notes, at) => queue.resolve(id, notes, at),
    metrics: (q) => metrics(db, { ...q, now: o.now(), timezone: o.timezone }),
  };
}
