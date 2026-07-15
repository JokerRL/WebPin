import { describe, expect, it } from "vitest";
import type { Annotation } from "@ui-annotations/shared";
import { buildTaskDraft, filterAnnotations, mergeVisualAssetPaths, removeAnnotationById, replaceAnnotation } from "./model";

const baseAnnotation: Annotation = {
  id: "ann_001",
  projectId: "sample",
  page: {
    url: "http://localhost:3000/settings",
    route: "/settings",
    title: "Settings",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
  },
  anchor: {
    dom: {
      selector: "[data-testid='save-button']",
      textExcerpt: "Save changes",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    },
    visual: {
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    }
  },
  note: "Button should be taller.",
  changeType: "layout",
  priority: "medium",
  status: "open",
  targetPlatforms: ["web"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

describe("panel model", () => {
  it("filters saved annotations by search, status, priority, and target platform", () => {
    const annotations: Annotation[] = [
      baseAnnotation,
      {
        ...baseAnnotation,
        id: "ann_002",
        note: "Use SwiftUI parity copy.",
        priority: "high",
        status: "drafted",
        targetPlatforms: ["ios-swiftui"]
      }
    ];

    const result = filterAnnotations(annotations, {
      search: "swiftui",
      status: "drafted",
      priority: "high",
      targetPlatform: "ios-swiftui"
    });

    expect(result.map((annotation) => annotation.id)).toEqual(["ann_002"]);
  });

  it("replaces and removes annotations without mutating the original list", () => {
    const annotations = [baseAnnotation];
    const updated = { ...baseAnnotation, status: "resolved" as const };

    expect(replaceAnnotation(annotations, updated)).toEqual([updated]);
    expect(removeAnnotationById(annotations, "ann_001")).toEqual([]);
    expect(annotations[0]?.status).toBe("open");
  });

  it("builds a task draft from selected annotations", () => {
    const draft = buildTaskDraft([
      baseAnnotation,
      {
        ...baseAnnotation,
        id: "ann_002",
        note: "Align iOS button too.",
        targetPlatforms: ["ios-swiftui"]
      }
    ]);

    expect(draft.taskId).toBe("task_ann_001_ann_002");
    expect(draft.userIntent).toContain("Button should be taller.");
    expect(draft.acceptanceCriteria).toEqual([
      "Address annotation ann_001: Button should be taller.",
      "Address annotation ann_002: Align iOS button too."
    ]);
  });

  it("merges captured screenshot and crop paths into visual anchors", () => {
    const result = mergeVisualAssetPaths(baseAnnotation, {
      screenshot: "assets/screenshots/ann_001.png",
      crop: "assets/crops/ann_001.png"
    });

    expect(result.anchor.visual).toMatchObject({
      screenshot: "assets/screenshots/ann_001.png",
      crop: "assets/crops/ann_001.png",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    });
    expect(baseAnnotation.anchor.visual.screenshot).toBeUndefined();
  });
});
