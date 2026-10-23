import { InMemorySessionStore } from "@frontdesk/core";
import { runSessionStoreContract } from "./session-store-contract.js";

runSessionStoreContract("in-memory", () => Promise.resolve(new InMemorySessionStore()));
