import { z } from "zod";

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
});

export const annotationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  page: z.object({
    url: z.string().url(),
    route: z.string().optional(),
    title: z.string().optional(),
    viewport: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      deviceScaleFactor: z.number().positive()
    })
  }),
  anchor: z.object({
    dom: z
      .object({
        selector: z.string().min(1).optional(),
        xpath: z.string().min(1).optional(),
        textExcerpt: z.string().optional(),
        boundingBox: boundingBoxSchema
      })
      .optional(),
    source: z
      .object({
        component: z.string().optional(),
        file: z.string().optional(),
        line: z.number().int().positive().optional(),
        gitCommit: z.string().optional()
      })
      .optional(),
    visual: z.object({
      screenshot: z.string().min(1).optional(),
      crop: z.string().min(1).optional(),
      boundingBox: boundingBoxSchema
    })
  }),
  note: z.string().min(1),
  changeType: z.enum(["copy", "layout", "color", "state", "navigation", "platform-parity", "other"]),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["open", "drafted", "sent-to-codex", "resolved", "deleted"]),
  targetPlatforms: z.array(z.enum(["web", "ios-swiftui"])).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const taskPackageSchema = z.object({
  taskId: z.string().min(1),
  sourceAnnotations: z.array(z.string().min(1)).min(1),
  userIntent: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  evidence: z.object({
    screenshots: z.array(z.string()).default([]),
    crops: z.array(z.string()).default([]),
    domSnapshots: z.array(z.string()).default([])
  }),
  targetPlatforms: z.array(z.enum(["web", "ios-swiftui"])).min(1),
  suggestedFiles: z.array(z.string()).default([]),
  status: z.enum(["draft", "ready", "sent", "resolved"])
});

export type Annotation = z.infer<typeof annotationSchema>;
export type TaskPackage = z.infer<typeof taskPackageSchema>;
