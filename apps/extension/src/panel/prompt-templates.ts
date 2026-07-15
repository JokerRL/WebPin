import type { Annotation } from "@ui-annotations/shared";

export type PromptTemplateId =
  | "web-frontend-implementer"
  | "ios-swiftui-implementer"
  | "web-ios-parity-implementer"
  | "ui-qa-fixer"
  | "implementation-planner";

export type PromptTemplate = {
  id: PromptTemplateId;
  label: string;
  role: string;
  focus: string[];
  implementationRules: string[];
  acceptanceCriteria: string[];
};

export const promptTemplates: PromptTemplate[] = [
  {
    id: "web-frontend-implementer",
    label: "Web frontend implementer",
    role: "Act as a senior Web frontend engineer.",
    focus: [
      "Parse the task JSON and Markdown before editing code.",
      "Use annotation notes as the source of truth for what to change.",
      "Interpret DOM anchor selector, XPath, text excerpt, bounding box, page URL, route, viewport, visual anchor, screenshots, crops, source anchors, target platforms, and suggested files.",
      "Locate the relevant component, style, state, route, or design-token implementation in the project."
    ],
    implementationRules: [
      "Prefer existing project patterns and local helper APIs.",
      "Keep the change narrowly scoped to the selected annotations.",
      "Do not refactor unrelated code.",
      "Run relevant Web build, typecheck, lint, or test commands when available.",
      "Report changed files and verification results."
    ],
    acceptanceCriteria: [
      "The implementation satisfies every selected annotation note.",
      "The targeted Web UI reflects the requested visual, copy, layout, state, or navigation change.",
      "No unrelated Web UI behavior or layout changes are introduced.",
      "Relevant Web build, typecheck, lint, or test commands pass, or any skipped verification is explained."
    ]
  },
  {
    id: "ios-swiftui-implementer",
    label: "iOS SwiftUI implementer",
    role: "Act as a senior iOS SwiftUI engineer.",
    focus: [
      "Parse the task JSON and Markdown before editing code.",
      "Use annotation notes and visual intent as the source of truth for what to change.",
      "Read Web DOM and visual anchors as evidence, not as a direct SwiftUI component map.",
      "Do not assume Web DOM elements map one-to-one to SwiftUI views.",
      "Locate relevant SwiftUI Views, ViewModels, design tokens, assets, and navigation logic."
    ],
    implementationRules: [
      "Translate the annotated UI intent into idiomatic SwiftUI.",
      "Prefer existing app architecture, naming, and design-system conventions.",
      "Keep the change narrowly scoped to the selected annotations.",
      "Do not modify unrelated Web code unless the task explicitly asks for parity work.",
      "Run available Swift, Xcode, or simulator verification when possible."
    ],
    acceptanceCriteria: [
      "The SwiftUI implementation reflects the annotated user intent rather than a mechanical DOM copy.",
      "The relevant iOS screen matches the requested visual, copy, layout, state, or navigation change.",
      "No unrelated SwiftUI screens or flows regress.",
      "Available Swift/Xcode verification passes, or any skipped verification is explained."
    ]
  },
  {
    id: "web-ios-parity-implementer",
    label: "Web + iOS parity implementer",
    role: "Act as a senior cross-platform product engineer for Web and iOS SwiftUI.",
    focus: [
      "Parse the task JSON and Markdown before editing code.",
      "Extract the product intent from annotation notes, visual anchors, page context, and target platforms.",
      "Compare how the requested behavior or visual treatment should appear on Web and iOS.",
      "Treat DOM anchors as Web evidence only; do not force one-to-one SwiftUI mapping."
    ],
    implementationRules: [
      "Implement Web and iOS changes only where the task package targets both platforms.",
      "Preserve platform-appropriate conventions while keeping product behavior consistent.",
      "Keep changes scoped and avoid unrelated refactors.",
      "Run available verification for each touched platform.",
      "Report platform-specific changed files and verification results separately."
    ],
    acceptanceCriteria: [
      "Web and iOS reflect the same product intent from the selected annotations.",
      "Each platform uses idiomatic implementation patterns.",
      "No unsupported DOM-to-SwiftUI mapping assumption is introduced.",
      "Relevant verification for touched platforms passes, or any skipped verification is explained."
    ]
  },
  {
    id: "ui-qa-fixer",
    label: "UI QA fixer",
    role: "Act as a UI QA engineer and implementation-focused frontend fixer.",
    focus: [
      "Parse the task JSON and Markdown before editing code.",
      "Use annotation notes, visual anchors, bounding boxes, viewport, screenshots, crops, and DOM anchors to identify the visible defect.",
      "Prioritize concrete UI issues: overflow, clipping, misalignment, inconsistent spacing, incorrect state, unreadable contrast, or broken interaction."
    ],
    implementationRules: [
      "Make the smallest code change that fixes the visible UI defect.",
      "Do not redesign unrelated parts of the screen.",
      "Check nearby states and responsive behavior that could be affected.",
      "Run focused verification for the touched UI area when available.",
      "Report what was visually fixed and how it was verified."
    ],
    acceptanceCriteria: [
      "The visible issue described by the selected annotations is fixed.",
      "Nearby UI does not shift, clip, overlap, or regress unexpectedly.",
      "The fix remains scoped to the annotated defect.",
      "Verification results or skipped-verification reasons are reported."
    ]
  },
  {
    id: "implementation-planner",
    label: "Implementation planner",
    role: "Act as a senior implementation planner. Do not edit code.",
    focus: [
      "Parse the task JSON and Markdown.",
      "Summarize each selected annotation note and its anchors.",
      "Identify likely files, components, styles, routes, states, or iOS views involved.",
      "Call out ambiguity, missing evidence, and verification needs."
    ],
    implementationRules: [
      "Do not modify files.",
      "Produce a concise implementation plan with ordered steps.",
      "Separate Web work from iOS work when both appear.",
      "Include risk notes and suggested verification commands.",
      "Ask for clarification only when the task package is insufficient to proceed safely."
    ],
    acceptanceCriteria: [
      "The output explains what should change for every selected annotation.",
      "The output lists likely files or areas to inspect.",
      "The output includes implementation steps and verification steps.",
      "No code changes are made."
    ]
  }
];

function describeAnnotations(annotations: Annotation[]): string[] {
  return annotations.map((annotation) => {
    const dom = annotation.anchor.dom;
    const visual = annotation.anchor.visual;
    const parts = [
      `- ${annotation.id}: ${annotation.note.trim()}`,
      `  - changeType: ${annotation.changeType}`,
      `  - priority: ${annotation.priority}`,
      `  - status: ${annotation.status}`,
      `  - targetPlatforms: ${annotation.targetPlatforms.join(", ")}`,
      `  - page: ${annotation.page.route ?? annotation.page.url}`,
      dom?.selector ? `  - dom.selector: ${dom.selector}` : null,
      dom?.xpath ? `  - dom.xpath: ${dom.xpath}` : null,
      dom?.textExcerpt ? `  - dom.textExcerpt: ${dom.textExcerpt}` : null,
      dom?.boundingBox
        ? `  - dom.boundingBox: x=${dom.boundingBox.x}, y=${dom.boundingBox.y}, width=${dom.boundingBox.width}, height=${dom.boundingBox.height}`
        : null,
      visual.boundingBox
        ? `  - visual.boundingBox: x=${visual.boundingBox.x}, y=${visual.boundingBox.y}, width=${visual.boundingBox.width}, height=${visual.boundingBox.height}`
        : null,
      visual.screenshot ? `  - visual.screenshot: ${visual.screenshot}` : null,
      visual.crop ? `  - visual.crop: ${visual.crop}` : null
    ].filter(Boolean);

    return parts.join("\n");
  });
}

export function applyPromptTemplate(templateId: PromptTemplateId, annotations: Annotation[]) {
  const template = promptTemplates.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown prompt template: ${templateId}`);
  }

  return {
    userIntent: [
      template.role,
      "",
      "Read and parse the generated task package files:",
      "- .ui-annotations/tasks/<task-id>.json",
      "- .ui-annotations/tasks/<task-id>.md",
      "- .ui-annotations/tasks/<task-id>.prompt.md",
      "",
      "Parse these task-package fields when present:",
      "- sourceAnnotations",
      "- userIntent",
      "- acceptanceCriteria",
      "- evidence.screenshots",
      "- evidence.crops",
      "- evidence.domSnapshots",
      "- targetPlatforms",
      "- suggestedFiles",
      "- DOM anchor selector, XPath, text excerpt, bounding box, page URL, route, viewport",
      "- visual anchor screenshot, crop, and bounding box",
      "- source anchor component, file, line, and git commit",
      "",
      "Template focus:",
      ...template.focus.map((item) => `- ${item}`),
      "",
      "Implementation rules:",
      ...template.implementationRules.map((item) => `- ${item}`),
      "",
      "Selected annotation context:",
      ...describeAnnotations(annotations)
    ].join("\n"),
    acceptanceCriteria: template.acceptanceCriteria
  };
}
