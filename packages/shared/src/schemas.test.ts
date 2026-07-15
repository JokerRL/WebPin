import { describe, expect, it } from "vitest";
import { annotationSchema, createTaskPackage, taskPackageSchema } from "./index";

const validAnnotation = {
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
      xpath: "//*[@data-testid='save-button']",
      textExcerpt: "Save changes",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    },
    visual: {
      screenshot: "assets/screenshots/ann_001.png",
      crop: "assets/crops/ann_001.png",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    }
  },
  note: "Button should be taller.",
  changeType: "layout",
  priority: "medium",
  status: "open",
  targetPlatforms: ["web", "ios-swiftui"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

describe("annotationSchema", () => {
  it("accepts a valid annotation with DOM and visual anchors", () => {
    expect(annotationSchema.parse(validAnnotation).id).toBe("ann_001");
  });

  it("rejects an annotation without a note", () => {
    expect(() => annotationSchema.parse({ ...validAnnotation, note: "" })).toThrow();
  });
});

describe("createTaskPackage", () => {
  it("creates a valid task package from annotations", () => {
    const taskPackage = createTaskPackage({
      taskId: "task_001",
      annotations: [annotationSchema.parse(validAnnotation)],
      userIntent: "Align save button with form controls.",
      acceptanceCriteria: ["Save button height matches form controls."],
      suggestedFiles: ["src/settings/SettingsForm.tsx"]
    });

    expect(taskPackageSchema.parse(taskPackage).sourceAnnotations).toEqual(["ann_001"]);
  });
});
