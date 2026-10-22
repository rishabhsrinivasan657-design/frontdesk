import type { AuditEvent } from "../../agent/types.js";
import type { AuditLog } from "../../ports/audit-log.js";
import { deepCopy, deepFreeze } from "./copy.js";

export class InMemoryAuditLog implements AuditLog {
  private readonly log: AuditEvent[] = [];
  private failing = false;
  private failIf: ((event: AuditEvent) => boolean) | undefined;

  /** The next append rejects and records nothing. */
  failNext(): void {
    this.failing = true;
  }

  /** Every append matching `predicate` rejects and records nothing. */
  failWhen(predicate: ((event: AuditEvent) => boolean) | undefined): void {
    this.failIf = predicate;
  }

  append(event: AuditEvent): Promise<void> {
    if (this.failing || this.failIf?.(event)) {
      this.failing = false;
      return Promise.reject(new Error("Audit log unavailable"));
    }
    this.log.push(deepFreeze(deepCopy(event)));
    return Promise.resolve();
  }

  entries(): readonly AuditEvent[] {
    return Object.freeze([...this.log]);
  }
}
