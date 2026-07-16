import { describe, expect, it } from "vitest";
import { AccessKeyError, assertAccessKey } from "./auth.js";

describe("assertAccessKey", () => {
  it("accepts the current access key", () => {
    expect(() => assertAccessKey("current-key", "current-key")).not.toThrow();
  });

  it.each([
    { label: "missing", submittedKey: undefined },
    { label: "empty", submittedKey: "" },
    { label: "incorrect with a different length", submittedKey: "wrong-key" },
    { label: "incorrect with the same length", submittedKey: "current-kex" }
  ])("rejects a $label access key", ({ submittedKey }) => {
    expect(() => assertAccessKey(submittedKey, "current-key")).toThrow(AccessKeyError);
  });

  it("exposes the access-key error contract", () => {
    let caughtError: unknown;

    try {
      assertAccessKey(undefined, "current-key");
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(AccessKeyError);
    expect(caughtError).toMatchObject({
      status: 401,
      code: "invalid_access_key",
      message: "Enter the current bridge access key in the extension."
    });
  });
});
