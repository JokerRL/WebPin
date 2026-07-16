import type { Annotation } from "@ui-annotations/shared";
import type { SelectedElement } from "./content";

export function createAnnotationFromSelection(input: {
  projectId: string;
  selection: SelectedElement;
  note: string;
  changeType: Annotation["changeType"];
  priority: Annotation["priority"];
  targetPlatforms: Annotation["targetPlatforms"];
}): Annotation {
  const now = new Date().toISOString();
  const id = globalThis.crypto?.randomUUID
    ? `ann_${globalThis.crypto.randomUUID().slice(0, 8)}`
    : `ann_${Date.now()}`;

  return {
    id,
    projectId: input.projectId,
    page: {
      url: input.selection.url,
      ...(input.selection.route ? { route: input.selection.route } : {}),
      ...(input.selection.title ? { title: input.selection.title } : {}),
      viewport: input.selection.viewport
    },
    anchor: {
      dom: {
        selector: input.selection.selector,
        xpath: input.selection.xpath,
        textExcerpt: input.selection.textExcerpt,
        boundingBox: input.selection.boundingBox
      },
      visual: { boundingBox: input.selection.boundingBox }
    },
    note: input.note,
    changeType: input.changeType,
    priority: input.priority,
    status: "open",
    targetPlatforms: input.targetPlatforms,
    createdAt: now,
    updatedAt: now
  };
}
