import type { Annotation } from "@ui-annotations/shared";
import { describe, expect, it } from "vitest";
import { findProjectMismatch } from "./project-association";

describe("findProjectMismatch", () => {
  it("accepts a batch owned by the authenticated project", () => {
    const annotations = [{ id: "ann_1", projectId: "webpin" }] as Annotation[];
    expect(findProjectMismatch(annotations, "WebPin")).toBeNull();
  });

  it("returns the first annotation owned by another project", () => {
    const annotations = [
      { id: "ann_1", projectId: "webpin" },
      { id: "ann_2", projectId: "other-project" }
    ] as Annotation[];
    expect(findProjectMismatch(annotations, "WebPin")?.id).toBe("ann_2");
  });
});
