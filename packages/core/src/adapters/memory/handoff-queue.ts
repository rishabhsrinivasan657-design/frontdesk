import type { HandoffTicket } from "../../agent/types.js";
import type { HandoffQueue } from "../../ports/handoff-queue.js";
import { deepCopy } from "./copy.js";

export class InMemoryHandoffQueue implements HandoffQueue {
  readonly tickets: HandoffTicket[] = [];

  enqueue(ticket: HandoffTicket): Promise<void> {
    this.tickets.push(deepCopy(ticket));
    return Promise.resolve();
  }
}
