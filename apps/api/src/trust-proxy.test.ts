import { describe, expect, it } from "vitest";
import { isPrivateAddress, trustProxySetting } from "./trust-proxy.js";

describe("trustProxySetting", () => {
  it("defaults to loopback only", () => {
    expect(trustProxySetting({})).toEqual(["127.0.0.1", "::1"]);
  });

  it("lists single proxy addresses from TRUST_PROXY", () => {
    expect(trustProxySetting({ TRUST_PROXY: "172.30.0.10, 172.30.0.11" })).toEqual([
      "172.30.0.10",
      "172.30.0.11",
    ]);
  });

  it("TRUST_PRIVATE_PROXY trusts one hop, and only from a private peer", () => {
    const trust = trustProxySetting({ TRUST_PRIVATE_PROXY: "1" });
    if (typeof trust !== "function") throw new Error("expected a function");
    expect(trust("10.214.3.4", 0)).toBe(true);
    expect(trust("::ffff:10.214.3.4", 0)).toBe(true);
    expect(trust("203.0.113.7", 0)).toBe(false);
    expect(trust("10.214.3.4", 1)).toBe(false);
  });

  it("rejects any other TRUST_PRIVATE_PROXY value", () => {
    expect(() => trustProxySetting({ TRUST_PRIVATE_PROXY: "yes" })).toThrow(/TRUST_PRIVATE_PROXY/);
  });
});

describe("isPrivateAddress", () => {
  it("knows private, carrier-grade NAT and loopback from public", () => {
    for (const a of [
      "10.0.0.1",
      "172.20.1.1",
      "192.168.1.1",
      "100.64.0.1",
      "127.0.0.1",
      "fd00::1",
    ]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ["8.8.8.8", "172.32.0.1", "203.0.113.7", "2001:db8::1"]) {
      expect(isPrivateAddress(a)).toBe(false);
    }
  });
});
