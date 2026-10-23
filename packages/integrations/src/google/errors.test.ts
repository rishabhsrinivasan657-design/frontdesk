import { describe, expect, it } from "vitest";
import { googleFailure, isUnavailable } from "./errors.js";

/** Shaped like a GaxiosError from googleapis, including the parts that hold secrets. */
function gaxiosError(status: number | undefined, data: unknown, code?: string) {
  return Object.assign(new Error("Request failed: Bearer ya29.SECRET"), {
    code,
    status,
    config: {
      headers: { Authorization: "Bearer ya29.SECRET" },
      data: "refresh_token=1//0gREFRESH&client_secret=GOCSPX-SECRET",
    },
    response: status === undefined ? undefined : { status, data },
  });
}

describe("googleFailure", () => {
  it("names the operation, status and Google's reason", () => {
    const e = gaxiosError(404, { error: { code: 404, errors: [{ reason: "notFound" }] } });
    expect(googleFailure(e, "Calendar events.get").message).toBe(
      "Calendar events.get failed: 404 notFound",
    );
  });

  it("keeps an OAuth error code like invalid_grant", () => {
    const e = gaxiosError(400, { error: "invalid_grant", error_description: "Token 1//0gREFRESH" });
    expect(googleFailure(e, "Gmail send").message).toBe("Gmail send failed: 400 invalid_grant");
  });

  it("never includes request headers or tokens in the message", () => {
    const e = gaxiosError(401, { error: { message: "Bearer ya29.SECRET is invalid" } });
    const failure = googleFailure(e, "Gmail send");
    const everything = JSON.stringify({
      ...failure,
      message: failure.message,
      stack: failure.stack,
    });
    expect(everything).not.toMatch(/SECRET|REFRESH|ya29|GOCSPX/);
    expect(failure.cause).toBeUndefined();
  });

  it("describes a network error by its code", () => {
    expect(
      googleFailure(gaxiosError(undefined, undefined, "ECONNREFUSED"), "Calendar").message,
    ).toBe("Calendar failed: network ECONNREFUSED");
  });
});

describe("isUnavailable", () => {
  it.each([
    ["503", gaxiosError(503, {}), true],
    ["429", gaxiosError(429, {}), true],
    ["network", gaxiosError(undefined, undefined, "ENOTFOUND"), true],
    ["timeout", Object.assign(new Error("t"), { name: "TimeoutError" }), true],
    ["404", gaxiosError(404, {}), false],
    ["invalid_grant", gaxiosError(400, { error: "invalid_grant" }), false],
  ])("%s → %s", (_label, error, expected) => {
    expect(isUnavailable(error)).toBe(expected);
  });
});
