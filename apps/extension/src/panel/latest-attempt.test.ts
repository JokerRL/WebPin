import { describe, expect, it } from "vitest";
import { createLatestAttemptGate } from "./latest-attempt";

describe("createLatestAttemptGate", () => {
  it("allows only the latest started attempt to mutate state", () => {
    const gate = createLatestAttemptGate();
    const startup = gate.begin();
    const connect = gate.begin();

    expect(gate.isLatest(startup)).toBe(false);
    expect(gate.isLatest(connect)).toBe(true);
  });

  it("invalidates the current attempt on unmount", () => {
    const gate = createLatestAttemptGate();
    const attempt = gate.begin();
    gate.invalidate();
    expect(gate.isLatest(attempt)).toBe(false);
  });
});
