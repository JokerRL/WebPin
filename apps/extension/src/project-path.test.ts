import { describe, expect, it } from "vitest";
import { inferProjectPathFromPageUrl } from "./project-path";

describe("inferProjectPathFromPageUrl", () => {
  it("infers the containing directory for file prototype pages", () => {
    expect(
      inferProjectPathFromPageUrl("file:///Users/joker/Desktop/familyLocator/prototype/app.html#invite-phone")
    ).toBe("/Users/joker/Desktop/familyLocator/prototype");
  });

  it("decodes escaped local file paths", () => {
    expect(inferProjectPathFromPageUrl("file:///Users/joker/Desktop/My%20Prototype/app.html?screen=1")).toBe(
      "/Users/joker/Desktop/My Prototype"
    );
  });

  it("does not infer project paths for hosted pages", () => {
    expect(inferProjectPathFromPageUrl("http://127.0.0.1:3000/app.html#welcome")).toBeNull();
  });
});
