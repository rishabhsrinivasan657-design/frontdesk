import type { ConfirmationEmail } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { buildRawMessage, renderConfirmation } from "./mime.js";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const headers = (raw: string) => decode(raw).split("\r\n\r\n")[0]!.split("\r\n");

const email: ConfirmationEmail = {
  kind: "book",
  to: "ana@example.com",
  businessName: "Casa Fiorella",
  sessionId: "s1",
  actionId: "act_1",
  booking: {
    id: "res_1",
    start: new Date("2026-11-08T00:00:00.000Z"), // 7:00 PM Nov 7 in New York
    end: new Date("2026-11-08T01:30:00.000Z"),
    tableId: "t4-1",
    partySize: 4,
    name: "Ana Ruiz",
    contact: "ana@example.com",
    notes: "",
  },
};

describe("buildRawMessage", () => {
  it("writes a UTF-8 plain-text message, base64url-encoded", () => {
    const raw = buildRawMessage({ to: "ana@example.com", subject: "Hi", text: "Body ✓" });
    expect(raw).not.toMatch(/[+/=]/);
    expect(headers(raw)).toEqual([
      "To: ana@example.com",
      "Subject: Hi",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ]);
    const body = decode(raw).split("\r\n\r\n")[1]!;
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Body ✓");
  });

  it("strips CR/LF from header values", () => {
    const raw = buildRawMessage({ to: "ana@example.com", subject: "Hi\r\nBcc: x@y.z", text: "" });
    expect(headers(raw)).not.toContain("Bcc: x@y.z");
    expect(headers(raw)).toContain("Subject: Hi Bcc: x@y.z");
  });

  it.each(["ana@example.com\r\nBcc: x@y.z", "a@b.co, c@d.co", "not-an-address", "Ana <a@b.co>"])(
    "rejects a to that is not a single bare address: %j",
    (to) => {
      expect(() => buildRawMessage({ to, subject: "Hi", text: "" })).toThrow(/address/);
    },
  );

  it("encodes a non-ASCII subject (RFC 2047)", () => {
    const raw = buildRawMessage({ to: "a@b.co", subject: "Café ✓", text: "" });
    expect(headers(raw)).toContain(
      `Subject: =?UTF-8?B?${Buffer.from("Café ✓").toString("base64")}?=`,
    );
  });
});

describe("renderConfirmation", () => {
  it("states the booking in the business time zone", () => {
    const { subject, text } = renderConfirmation(email, "America/New_York");
    expect(subject).toBe("Your reservation at Casa Fiorella is confirmed");
    expect(text).toContain("Saturday, November 7 at 7:00 PM");
    expect(text).toContain("table for 4");
    expect(text).toContain("Ana Ruiz");
  });

  it.each([
    ["reschedule", "Your reservation at Casa Fiorella has been moved"],
    ["cancel", "Your reservation at Casa Fiorella has been cancelled"],
  ] as const)("has a %s subject", (kind, subject) => {
    expect(renderConfirmation({ ...email, kind }, "America/New_York").subject).toBe(subject);
  });
});
