import type { HandoffTicket } from "../agent/types.js";

export interface HandoffQueue {
  enqueue(ticket: HandoffTicket): Promise<void>;
}
