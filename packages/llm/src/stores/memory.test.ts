import { runStoreContracts } from "./contract.js";
import { MemoryCacheStore, MemoryRateLimitStore, MemorySpendStore } from "./memory.js";

runStoreContracts("memory", {
  rate: () => new MemoryRateLimitStore(),
  spend: () => new MemorySpendStore(),
  cache: () => {
    let now = 0;
    return {
      store: new MemoryCacheStore(() => now),
      advance: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    };
  },
});
