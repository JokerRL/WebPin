import type { Annotation } from "@ui-annotations/shared";

export type AnnotationFilters = {
  search: string;
  status: "all" | Annotation["status"];
  priority: "all" | Annotation["priority"];
  targetPlatform: "all" | Annotation["targetPlatforms"][number];
};

export type TaskDraft = {
  taskId: string;
  userIntent: string;
  acceptanceCriteria: string[];
};

export type VisualAssetPaths = {
  screenshot?: string;
  crop?: string;
};

export function filterAnnotations(annotations: Annotation[], filters: AnnotationFilters): Annotation[] {
  const search = filters.search.trim().toLowerCase();

  return annotations.filter((annotation) => {
    const searchable = [
      annotation.id,
      annotation.note,
      annotation.anchor.dom?.selector,
      annotation.anchor.dom?.textExcerpt,
      annotation.page.route,
      annotation.page.title
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      (!search || searchable.includes(search)) &&
      (filters.status === "all" || annotation.status === filters.status) &&
      (filters.priority === "all" || annotation.priority === filters.priority) &&
      (filters.targetPlatform === "all" || annotation.targetPlatforms.includes(filters.targetPlatform))
    );
  });
}

export function replaceAnnotation(annotations: Annotation[], updatedAnnotation: Annotation): Annotation[] {
  return annotations.map((annotation) => (annotation.id === updatedAnnotation.id ? updatedAnnotation : annotation));
}

export function removeAnnotationById(annotations: Annotation[], annotationId: string): Annotation[] {
  return annotations.filter((annotation) => annotation.id !== annotationId);
}

export function mergeVisualAssetPaths(annotation: Annotation, paths: VisualAssetPaths): Annotation {
  return {
    ...annotation,
    anchor: {
      ...annotation.anchor,
      visual: {
        ...annotation.anchor.visual,
        ...(paths.screenshot ? { screenshot: paths.screenshot } : {}),
        ...(paths.crop ? { crop: paths.crop } : {})
      }
    }
  };
}

export function buildTaskDraft(annotations: Annotation[]): TaskDraft {
  const taskId = `task_${annotations.map((annotation) => annotation.id).join("_")}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const notes = annotations.map((annotation) => annotation.note.trim()).filter(Boolean);

  return {
    taskId: taskId.slice(0, 80),
    userIntent: notes.join("\n"),
    acceptanceCriteria: annotations.map((annotation) => `Address annotation ${annotation.id}: ${annotation.note.trim()}`)
  };
}
