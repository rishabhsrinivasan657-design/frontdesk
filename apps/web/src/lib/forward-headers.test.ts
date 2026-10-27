import { describe, expect, it } from "vitest";
import { forwardHeaders } from "./forward-headers";

const incoming = new Headers({
  cookie: "fd_owner=abc",
  "content-type": "application/json",
  origin: "https://casa.duckdns.org",
  accept: "*/*",
  authorization: "Bearer x",
  "x-forwarded-for": "6.6.6.6, 1.2.3.4",
});

describe("forwardHeaders", () => {
  it("passes only the allow-listed headers and never X-Forwarded-For by default", () => {
    const out = forwardHeaders(incoming, {});
    expect([...out.keys()].sort()).toEqual(["accept", "content-type", "cookie", "origin"]);
  });

  it("behind Caddy forwards only the address Caddy added (the last one)", () => {
    const out = forwardHeaders(incoming, { TRUST_FORWARDED_FOR: "1" });
    expect(out.get("x-forwarded-for")).toBe("1.2.3.4");
  });
});
