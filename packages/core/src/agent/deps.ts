import type { GateDeps } from "../gate/deps.js";
import type { HandoffQueue } from "../ports/handoff-queue.js";

export interface AgentDeps extends GateDeps {
  handoffs: HandoffQueue;
}
