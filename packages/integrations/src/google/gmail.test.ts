import { describe, expect, it } from "vitest";
import { GmailMailer, type MessagesApi } from "./gmail.js";
import { email } from "./mailer-fixtures.js";

describe("GmailMailer", () => {
  it("sends one raw message as the signed-in user", async () => {
    const calls: Parameters<MessagesApi["send"]>[0][] = [];
    const messages: MessagesApi = {
      send: (p) => {
        calls.push(p);
        return Promise.resolve({ data: {} });
      },
    };
    await new GmailMailer({ messages, timeZone: "America/New_York" }).sendConfirmation(email);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.userId).toBe("me");
    const raw = Buffer.from(calls[0]!.requestBody!.raw!, "base64url").toString("utf8");
    expect(raw).toContain("To: ana@example.com");
  });

  it("rethrows a secret-free error", async () => {
    const messages: MessagesApi = {
      send: () =>
        Promise.reject(
          Object.assign(new Error("Bearer ya29.SECRET"), {
            response: { status: 401, data: { error: "invalid_grant" } },
          }),
        ),
    };
    const sending = new GmailMailer({ messages, timeZone: "America/New_York" }).sendConfirmation(
      email,
    );
    await expect(sending).rejects.toThrow("Gmail send failed: 401 invalid_grant");
  });
});
