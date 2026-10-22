import type { AuditEvent } from "../agent/types.js";

/** Append-only by construction: there is no update or delete (spec §6). */
export interface AuditLog {
  append(event: AuditEvent): Promise<void>;
}
