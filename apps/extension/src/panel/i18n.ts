export type PanelLanguage = "en" | "zh";

type PanelCopy = {
  title: string;
  bridgeStatus: (status: string) => string;
  shortcut: string;
  mode: (mode: string) => string;
  browseMode: string;
  accessKey: string;
  accessKeyPlaceholder: string;
  connectBridge: string;
  connectionStatuses: Record<"offline" | "key-required" | "ready", string>;
  screenshotCaptureTitle: string;
  screenshotCaptureDescription: string;
  selectedElement: string;
  selectedElementEmpty: string;
  boundingBoxSummary: (width: number, height: number, x: number, y: number) => string;
  selectElement: string;
  selectingElement: string;
  shortcutDescription: string;
  pendingAnnotations: string;
  pendingEmpty: string;
  remove: string;
  saveAllToFiles: string;
  savedAnnotations: string;
  refresh: string;
  searchSavedAnnotations: string;
  search: string;
  filterByStatus: string;
  filterByPriority: string;
  filterByTargetPlatform: string;
  allStatus: string;
  allPriority: string;
  allTargets: string;
  statuses: Record<string, string>;
  priorities: Record<string, string>;
  targets: Record<string, string>;
  delete: string;
  savedEmpty: string;
  taskPackage: string;
  selectedCount: (count: number) => string;
  draftFromSelection: string;
  promptTemplate: string;
  promptTemplates: Record<string, string>;
  apply: string;
  taskId: string;
  userIntent: string;
  userIntentPlaceholder: string;
  acceptanceCriteria: string;
  acceptanceCriteriaPlaceholder: string;
  suggestedFiles: string;
  suggestedFilesPlaceholder: string;
  generateTaskFiles: string;
  sendToCodex: string;
  codexRunning: string;
  note: string;
  notePlaceholder: string;
  type: string;
  changeTypes: Record<string, string>;
  priority: string;
  targetsLegend: string;
  saving: string;
  addToPendingList: string;
  messages: {
    accessKeyRejected: string;
    bridgeOffline: string;
    bridgeReady: (projectName: string) => string;
    clickElement: string;
    couldNotStartSelection: string;
    updatingProjectSettings: string;
    couldNotUpdateProjectSettings: string;
    screenshotEnabled: string;
    screenshotDisabled: string;
    selectElementFirst: string;
    writeNoteBeforeSaving: string;
    capturingScreenshotAssets: string;
    couldNotCaptureScreenshotAssets: string;
    addedToPending: (annotationId: string) => string;
    loadingSavedAnnotations: string;
    savedAnnotationsLoaded: string;
    updatingAnnotation: (annotationId: string) => string;
    couldNotUpdateAnnotation: (annotationId: string) => string;
    updatedAnnotation: (annotationId: string) => string;
    deletingAnnotation: (annotationId: string) => string;
    couldNotDeleteAnnotation: (annotationId: string) => string;
    deletedAnnotation: (annotationId: string) => string;
    noPendingAnnotations: string;
    savingAnnotations: (count: number) => string;
    bridgeRejected: (annotationId: string) => string;
    savedAnnotationsToFiles: (count: number) => string;
    selectSavedForTask: string;
    selectSavedBeforeTemplate: string;
    taskFieldsRequired: string;
    generatingTask: (taskId: string) => string;
    couldNotGenerateTask: (taskId: string) => string;
    generatedTask: (taskPath: string) => string;
    generateBeforeCodex: string;
    sendingToCodex: (taskId: string) => string;
    couldNotSendToCodex: (taskId: string) => string;
    codexCompleted: (runId: string) => string;
    codexFailed: (runId: string, detail: string) => string;
    seeRunRecord: string;
    couldNotLoadSavedAnnotations: string;
    couldNotLoadProjectSettings: string;
  };
};

export const panelText: Record<PanelLanguage, PanelCopy> = {
  en: {
    title: "UI Annotations",
    bridgeStatus: (status) => `Bridge: ${status}`,
    shortcut: "macOS: Ctrl+Shift+Y / ⌃⇧Y",
    mode: (mode) => `Mode: ${mode}`,
    browseMode: "browse",
    accessKey: "Access key",
    accessKeyPlaceholder: "Paste the key printed by the bridge",
    connectBridge: "Connect",
    connectionStatuses: {
      offline: "Bridge offline",
      "key-required": "Key required",
      ready: "Ready"
    },
    screenshotCaptureTitle: "Capture screenshot and crop",
    screenshotCaptureDescription: "Saved locally under .ui-annotations/assets when enabled.",
    selectedElement: "Selected element",
    selectedElementEmpty: "Click Select element, then click one element in the page.",
    boundingBoxSummary: (width, height, x, y) => `${width}x${height} at ${x}, ${y}`,
    selectElement: "Select element",
    selectingElement: "Click an element on the page",
    shortcutDescription: "Shortcut toggles annotation mode. Page clicks are blocked while selecting or editing.",
    pendingAnnotations: "Pending annotations",
    pendingEmpty: "Inline popup saves appear here first. Use Save all to write files.",
    remove: "Remove",
    saveAllToFiles: "Save all to files",
    savedAnnotations: "Saved annotations",
    refresh: "Refresh",
    searchSavedAnnotations: "Search saved annotations",
    search: "Search",
    filterByStatus: "Filter by status",
    filterByPriority: "Filter by priority",
    filterByTargetPlatform: "Filter by target platform",
    allStatus: "All status",
    allPriority: "All priority",
    allTargets: "All targets",
    statuses: {
      open: "Open",
      drafted: "Drafted",
      "sent-to-codex": "Sent to Codex",
      resolved: "Resolved"
    },
    priorities: {
      low: "Low",
      medium: "Medium",
      high: "High"
    },
    targets: {
      web: "Web",
      "ios-swiftui": "iOS SwiftUI"
    },
    delete: "Delete",
    savedEmpty: "Saved annotations from .ui-annotations appear here after refresh or file save.",
    taskPackage: "Task package",
    selectedCount: (count) => `${count} selected`,
    draftFromSelection: "Draft from selection",
    promptTemplate: "Prompt template",
    promptTemplates: {
      "web-frontend-implementer": "Web frontend implementer",
      "ios-swiftui-implementer": "iOS SwiftUI implementer",
      "web-ios-parity-implementer": "Web + iOS parity implementer",
      "ui-qa-fixer": "UI QA fixer",
      "implementation-planner": "Implementation planner"
    },
    apply: "Apply",
    taskId: "Task ID",
    userIntent: "User intent",
    userIntentPlaceholder: "Summarize the implementation intent.",
    acceptanceCriteria: "Acceptance criteria",
    acceptanceCriteriaPlaceholder: "One criterion per line.",
    suggestedFiles: "Suggested files",
    suggestedFilesPlaceholder: "One file path per line.",
    generateTaskFiles: "Generate task files",
    sendToCodex: "Send to Codex",
    codexRunning: "Codex running...",
    note: "Note",
    notePlaceholder: "Describe the requested UI change.",
    type: "Type",
    changeTypes: {
      layout: "Layout",
      copy: "Copy",
      color: "Color",
      state: "State",
      navigation: "Navigation",
      "platform-parity": "Platform parity",
      other: "Other"
    },
    priority: "Priority",
    targetsLegend: "Targets",
    saving: "Saving...",
    addToPendingList: "Add to pending list",
    messages: {
      accessKeyRejected: "Access key rejected.",
      bridgeOffline: "Bridge offline.",
      bridgeReady: (projectName) => `Bridge ready for ${projectName}.`,
      clickElement: "Click one element on the page.",
      couldNotStartSelection: "Could not start selection on the active tab.",
      updatingProjectSettings: "Updating project settings...",
      couldNotUpdateProjectSettings: "Could not update project settings.",
      screenshotEnabled: "Screenshot capture enabled.",
      screenshotDisabled: "Screenshot capture disabled.",
      selectElementFirst: "Select an element on the page first.",
      writeNoteBeforeSaving: "Write a note before saving.",
      capturingScreenshotAssets: "Capturing screenshot assets...",
      couldNotCaptureScreenshotAssets: "Could not capture screenshot assets.",
      addedToPending: (annotationId) => `Added ${annotationId} to pending list`,
      loadingSavedAnnotations: "Loading saved annotations...",
      savedAnnotationsLoaded: "Saved annotations loaded.",
      updatingAnnotation: (annotationId) => `Updating ${annotationId}...`,
      couldNotUpdateAnnotation: (annotationId) => `Could not update ${annotationId}.`,
      updatedAnnotation: (annotationId) => `Updated ${annotationId}.`,
      deletingAnnotation: (annotationId) => `Deleting ${annotationId}...`,
      couldNotDeleteAnnotation: (annotationId) => `Could not delete ${annotationId}.`,
      deletedAnnotation: (annotationId) => `Deleted ${annotationId}.`,
      noPendingAnnotations: "No pending annotations to save.",
      savingAnnotations: (count) => `Saving ${count} annotations...`,
      bridgeRejected: (annotationId) => `Bridge rejected ${annotationId}.`,
      savedAnnotationsToFiles: (count) => `Saved ${count} annotations to .ui-annotations`,
      selectSavedForTask: "Select at least one saved annotation for the task package.",
      selectSavedBeforeTemplate: "Select at least one saved annotation before applying a template.",
      taskFieldsRequired: "Task ID, user intent, and acceptance criteria are required.",
      generatingTask: (taskId) => `Generating ${taskId}...`,
      couldNotGenerateTask: (taskId) => `Could not generate ${taskId}.`,
      generatedTask: (taskPath) => `Generated ${taskPath}.`,
      generateBeforeCodex: "Generate task files before sending to Codex.",
      sendingToCodex: (taskId) => `Sending ${taskId} to Codex...`,
      couldNotSendToCodex: (taskId) => `Could not send ${taskId} to Codex.`,
      codexCompleted: (runId) => `Codex completed ${runId}.`,
      codexFailed: (runId, detail) => `Codex failed ${runId}: ${detail}`,
      seeRunRecord: "see run record",
      couldNotLoadSavedAnnotations: "Could not load saved annotations.",
      couldNotLoadProjectSettings: "Could not load project settings."
    }
  },
  zh: {
    title: "UI 标注",
    bridgeStatus: (status) => `桥接服务：${status}`,
    shortcut: "macOS：Ctrl+Shift+Y / ⌃⇧Y",
    mode: (mode) => `模式：${mode}`,
    browseMode: "浏览",
    accessKey: "访问密钥",
    accessKeyPlaceholder: "粘贴 bridge 启动时显示的密钥",
    connectBridge: "连接",
    connectionStatuses: {
      offline: "Bridge 离线",
      "key-required": "需要密钥",
      ready: "已就绪"
    },
    screenshotCaptureTitle: "保存截图和裁剪图",
    screenshotCaptureDescription: "开启后会保存到本地 .ui-annotations/assets。",
    selectedElement: "已选元素",
    selectedElementEmpty: "点击“选择元素”，然后在页面中点击一个元素。",
    boundingBoxSummary: (width, height, x, y) => `${width}x${height}，位置 ${x}, ${y}`,
    selectElement: "选择元素",
    selectingElement: "点击页面中的元素",
    shortcutDescription: "快捷键可切换标注模式。选择或编辑时会拦截页面点击。",
    pendingAnnotations: "待保存标注",
    pendingEmpty: "内联弹窗保存的标注会先显示在这里。点击“全部保存到文件”后写入文件。",
    remove: "移除",
    saveAllToFiles: "全部保存到文件",
    savedAnnotations: "已保存标注",
    refresh: "刷新",
    searchSavedAnnotations: "搜索已保存标注",
    search: "搜索",
    filterByStatus: "按状态筛选",
    filterByPriority: "按优先级筛选",
    filterByTargetPlatform: "按目标平台筛选",
    allStatus: "全部状态",
    allPriority: "全部优先级",
    allTargets: "全部目标",
    statuses: {
      open: "待处理",
      drafted: "已起草",
      "sent-to-codex": "已发送",
      resolved: "已解决"
    },
    priorities: {
      low: "低",
      medium: "中",
      high: "高"
    },
    targets: {
      web: "Web",
      "ios-swiftui": "iOS SwiftUI"
    },
    delete: "删除",
    savedEmpty: "刷新或保存文件后，.ui-annotations 中的标注会显示在这里。",
    taskPackage: "任务包",
    selectedCount: (count) => `已选 ${count} 条`,
    draftFromSelection: "根据所选生成草稿",
    promptTemplate: "提示词模板",
    promptTemplates: {
      "web-frontend-implementer": "Web 前端实现",
      "ios-swiftui-implementer": "iOS SwiftUI 实现",
      "web-ios-parity-implementer": "Web + iOS 一致性实现",
      "ui-qa-fixer": "UI QA 修复",
      "implementation-planner": "实现规划"
    },
    apply: "应用",
    taskId: "任务 ID",
    userIntent: "用户意图",
    userIntentPlaceholder: "总结这次实现要达成的目标。",
    acceptanceCriteria: "验收标准",
    acceptanceCriteriaPlaceholder: "每行一条标准。",
    suggestedFiles: "建议文件",
    suggestedFilesPlaceholder: "每行一个文件路径。",
    generateTaskFiles: "生成任务文件",
    sendToCodex: "发送给 Codex",
    codexRunning: "Codex 运行中...",
    note: "备注",
    notePlaceholder: "描述希望调整的 UI。",
    type: "类型",
    changeTypes: {
      layout: "布局",
      copy: "文案",
      color: "颜色",
      state: "状态",
      navigation: "导航",
      "platform-parity": "平台一致性",
      other: "其他"
    },
    priority: "优先级",
    targetsLegend: "目标平台",
    saving: "保存中...",
    addToPendingList: "加入待保存列表",
    messages: {
      accessKeyRejected: "访问密钥被拒绝。",
      bridgeOffline: "Bridge 离线。",
      bridgeReady: (projectName) => `Bridge 已为 ${projectName} 就绪。`,
      clickElement: "请在页面中点击一个元素。",
      couldNotStartSelection: "无法在当前标签页开始选择。",
      updatingProjectSettings: "正在更新项目设置...",
      couldNotUpdateProjectSettings: "无法更新项目设置。",
      screenshotEnabled: "已开启截图保存。",
      screenshotDisabled: "已关闭截图保存。",
      selectElementFirst: "请先在页面中选择一个元素。",
      writeNoteBeforeSaving: "保存前请先填写备注。",
      capturingScreenshotAssets: "正在保存截图资源...",
      couldNotCaptureScreenshotAssets: "无法保存截图资源。",
      addedToPending: (annotationId) => `已将 ${annotationId} 加入待保存列表`,
      loadingSavedAnnotations: "正在加载已保存标注...",
      savedAnnotationsLoaded: "已加载保存的标注。",
      updatingAnnotation: (annotationId) => `正在更新 ${annotationId}...`,
      couldNotUpdateAnnotation: (annotationId) => `无法更新 ${annotationId}。`,
      updatedAnnotation: (annotationId) => `已更新 ${annotationId}。`,
      deletingAnnotation: (annotationId) => `正在删除 ${annotationId}...`,
      couldNotDeleteAnnotation: (annotationId) => `无法删除 ${annotationId}。`,
      deletedAnnotation: (annotationId) => `已删除 ${annotationId}。`,
      noPendingAnnotations: "没有待保存的标注。",
      savingAnnotations: (count) => `正在保存 ${count} 条标注...`,
      bridgeRejected: (annotationId) => `桥接服务拒绝了 ${annotationId}。`,
      savedAnnotationsToFiles: (count) => `已将 ${count} 条标注保存到 .ui-annotations`,
      selectSavedForTask: "请至少选择一条已保存标注来生成任务包。",
      selectSavedBeforeTemplate: "应用模板前请至少选择一条已保存标注。",
      taskFieldsRequired: "任务 ID、用户意图和验收标准都是必填项。",
      generatingTask: (taskId) => `正在生成 ${taskId}...`,
      couldNotGenerateTask: (taskId) => `无法生成 ${taskId}。`,
      generatedTask: (taskPath) => `已生成 ${taskPath}。`,
      generateBeforeCodex: "请先生成任务文件，再发送给 Codex。",
      sendingToCodex: (taskId) => `正在将 ${taskId} 发送给 Codex...`,
      couldNotSendToCodex: (taskId) => `无法将 ${taskId} 发送给 Codex。`,
      codexCompleted: (runId) => `Codex 已完成 ${runId}。`,
      codexFailed: (runId, detail) => `Codex 执行失败 ${runId}：${detail}`,
      seeRunRecord: "查看运行记录",
      couldNotLoadSavedAnnotations: "无法加载已保存标注。",
      couldNotLoadProjectSettings: "无法加载项目设置。"
    }
  }
};

export function getPanelLanguage(languages?: readonly string[]): PanelLanguage {
  const browserLanguages =
    languages ??
    (typeof navigator !== "undefined"
      ? navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language]
      : []);

  return browserLanguages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh" : "en";
}
