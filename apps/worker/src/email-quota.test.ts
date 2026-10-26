import { describe, expect, it } from "vitest";
import { MemoryEmailQuota } from "./email-quota.js";

describe("MemoryEmailQuota", () => {
  it("caps each recipient per day", async () => {
    const q = new MemoryEmailQuota({ perRecipient: 3, global: 50 });
    for (let i = 0; i < 3; i++) expect(await q.take("ana@example.com", "2026-11-06")).toBe("ok");
    expect(await q.take("ana@example.com", "2026-11-06")).toBe("recipient_cap");
    expect(await q.take("ana@example.com", "2026-11-07")).toBe("ok");
  });

  it("recipient cap ignores case and spacing", async () => {
    const q = new MemoryEmailQuota({ perRecipient: 1, global: 50 });
    expect(await q.take("Ana@Example.com ", "2026-11-06")).toBe("ok");
    expect(await q.take("ana@example.com", "2026-11-06")).toBe("recipient_cap");
  });

  it("caps all emails per day", async () => {
    const q = new MemoryEmailQuota({ perRecipient: 3, global: 2 });
    expect(await q.take("a@x.com", "2026-11-06")).toBe("ok");
    expect(await q.take("b@x.com", "2026-11-06")).toBe("ok");
    expect(await q.take("c@x.com", "2026-11-06")).toBe("global_cap");
  });
});
