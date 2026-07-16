import { describe, expect, it } from "vitest";
import { createAnnotationFromSelection } from "./annotation-factory";

describe("createAnnotationFromSelection", () => {
  it("uses the exact authenticated project identity and preserves DOM and visual anchors", () => {
    const annotation = createAnnotationFromSelection({
      projectId: "project_AbCdEf0123_-opaque",
      selection: {
        url: "http://localhost/settings",
        route: "/settings",
        title: "Settings",
        selector: "[data-testid=save]",
        xpath: "/html/body/button",
        textExcerpt: "Save",
        boundingBox: { x: 10, y: 20, width: 100, height: 40 },
        viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }
      },
      note: "Make it taller",
      changeType: "layout",
      priority: "high",
      targetPlatforms: ["web"]
    });

    expect(annotation.projectId).toBe("project_AbCdEf0123_-opaque");
    expect(annotation.anchor.dom).toMatchObject({
      selector: "[data-testid=save]",
      xpath: "/html/body/button",
      textExcerpt: "Save",
      boundingBox: { x: 10, y: 20, width: 100, height: 40 }
    });
    expect(annotation.anchor.visual).toEqual({
      boundingBox: { x: 10, y: 20, width: 100, height: 40 }
    });
    expect(annotation.status).toBe("open");
    expect(annotation.targetPlatforms).toEqual(["web"]);
  });
});
