import { describe, expect, it } from "vitest";
import { AccessKeyError, assertAccessKey } from "./auth.js";

describe("assertAccessKey", () => {
  it("accepts the current access key", () => {
    expect(() => assertAccessKey("current-key", "current-key")).not.toThrow();
  });

  it.each([
    { label: "missing", submittedKey: undefined },
    { label: "empty", submittedKey: "" },
    { label: "incorrect", submittedKey: "wrong-key" }
  ])("rejects a $label access key", ({ submittedKey }) => {
    expect(() => assertAccessKey(submittedKey, "current-key")).toThrow(AccessKeyError);
  });
});
