import { describe, expect, it } from "vitest";
import type { Annotation } from "@ui-annotations/shared";
import { applyPromptTemplate, promptTemplates } from "./prompt-templates";

const annotation: Annotation = {
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
  note: "Button should be taller and aligned with inputs.",
  changeType: "layout",
  priority: "medium",
  status: "open",
  targetPlatforms: ["web"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

describe("prompt templates", () => {
  it("provides execution templates that describe role and parsing strategy", () => {
    expect(promptTemplates.map((template) => template.id)).toEqual([
      "web-frontend-implementer",
      "ios-swiftui-implementer",
      "web-ios-parity-implementer",
      "ui-qa-fixer",
      "implementation-planner"
    ]);
  });

  it("applies a selected execution template to annotation context", () => {
    const draft = applyPromptTemplate("web-frontend-implementer", [annotation]);

    expect(draft.userIntent).toContain("Act as a senior Web frontend engineer.");
    expect(draft.userIntent).toContain("Parse the task JSON and Markdown");
    expect(draft.userIntent).toContain("DOM anchor selector, XPath, text excerpt, bounding box, page URL, route, viewport");
    expect(draft.userIntent).toContain("ann_001: Button should be taller");
    expect(draft.acceptanceCriteria).toContain("The implementation satisfies every selected annotation note.");
    expect(draft.acceptanceCriteria).toContain("Relevant Web build, typecheck, lint, or test commands pass, or any skipped verification is explained.");
  });

  it("can build an iOS SwiftUI execution template without assuming DOM parity", () => {
    const draft = applyPromptTemplate("ios-swiftui-implementer", [annotation]);

    expect(draft.userIntent).toContain("Act as a senior iOS SwiftUI engineer.");
    expect(draft.userIntent).toContain("Do not assume Web DOM elements map one-to-one to SwiftUI views.");
    expect(draft.acceptanceCriteria).toContain("The SwiftUI implementation reflects the annotated user intent rather than a mechanical DOM copy.");
  });
});
