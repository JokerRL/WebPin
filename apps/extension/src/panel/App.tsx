import { useEffect, useState } from "react";
import type { Annotation } from "@ui-annotations/shared";
import type { SelectedElement } from "../content";
import { inferProjectPathFromPageUrl } from "../project-path";
import {
  buildTaskDraft,
  filterAnnotations,
  mergeVisualAssetPaths,
  removeAnnotationById,
  replaceAnnotation,
  type VisualAssetPaths,
  type AnnotationFilters
} from "./model";
import { applyPromptTemplate, promptTemplates, type PromptTemplateId } from "./prompt-templates";
import { getPanelLanguage, panelText } from "./i18n";

const selectionKey = "ui-annotations.lastSelection";
const projectPathKey = "ui-annotations.projectPath";
const pendingAnnotationsKey = "ui-annotations.pendingAnnotations";
const modeKey = "ui-annotations.mode";
const screenshotCaptureEnabledKey = "ui-annotations.screenshotCaptureEnabled";
const bridgeUrl = "http://127.0.0.1:48731";

type SaveState = "idle" | "saving" | "saved" | "error";
type AnnotationMode = "idle" | "selecting" | "editing";
type EditableStatus = Exclude<Annotation["status"], "deleted">;

function newAnnotationId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `ann_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }

  return `ann_${Date.now()}`;
}

function projectIdFromPath(projectPath: string): string {
  const normalized = projectPath.replace(/\/+$/, "");
  const name = normalized.split("/").filter(Boolean).at(-1) ?? "project";
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "project";
}

function createAnnotation(input: {
  projectPath: string;
  selection: SelectedElement;
  note: string;
  changeType: Annotation["changeType"];
  priority: Annotation["priority"];
  targetPlatforms: Annotation["targetPlatforms"];
}): Annotation {
  const now = new Date().toISOString();
  return {
    id: newAnnotationId(),
    projectId: projectIdFromPath(input.projectPath),
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
      visual: {
        boundingBox: input.selection.boundingBox
      }
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

export function App() {
  const t = panelText[getPanelLanguage()];
  const [bridgeStatus, setBridgeStatus] = useState("checking");
  const [selection, setSelection] = useState<SelectedElement | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [note, setNote] = useState("");
  const [changeType, setChangeType] = useState<Annotation["changeType"]>("layout");
  const [priority, setPriority] = useState<Annotation["priority"]>("medium");
  const [targetPlatforms, setTargetPlatforms] = useState<Annotation["targetPlatforms"]>(["web"]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [isSelecting, setIsSelecting] = useState(false);
  const [pendingAnnotations, setPendingAnnotations] = useState<Annotation[]>([]);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("idle");
  const [savedAnnotations, setSavedAnnotations] = useState<Annotation[]>([]);
  const [filters, setFilters] = useState<AnnotationFilters>({
    search: "",
    status: "all",
    priority: "all",
    targetPlatform: "all"
  });
  const [selectedTaskAnnotationIds, setSelectedTaskAnnotationIds] = useState<string[]>([]);
  const [taskId, setTaskId] = useState("");
  const [userIntent, setUserIntent] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [suggestedFiles, setSuggestedFiles] = useState("");
  const [lastGeneratedTaskId, setLastGeneratedTaskId] = useState("");
  const [agentRunState, setAgentRunState] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [selectedPromptTemplate, setSelectedPromptTemplate] = useState<PromptTemplateId>("web-frontend-implementer");
  const [screenshotCaptureEnabled, setScreenshotCaptureEnabled] = useState(false);

  const loadSavedAnnotations = async (path: string) => {
    if (!path.trim()) {
      setSavedAnnotations([]);
      setSelectedTaskAnnotationIds([]);
      return;
    }

    const response = await fetch(`${bridgeUrl}/annotations?projectPath=${encodeURIComponent(path.trim())}`);
    const body = (await response.json()) as { annotations?: Annotation[]; message?: string; error?: string };
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? t.messages.couldNotLoadSavedAnnotations);
    }
    const annotations = body.annotations ?? [];
    setSavedAnnotations(annotations);
    setSelectedTaskAnnotationIds((current) =>
      current.filter((annotationId) => annotations.some((annotation) => annotation.id === annotationId))
    );
  };

  const loadProjectSettings = async (path: string) => {
    if (!path.trim()) {
      setScreenshotCaptureEnabled(false);
      return;
    }
    const response = await fetch(`${bridgeUrl}/project-settings?projectPath=${encodeURIComponent(path.trim())}`);
    const body = (await response.json()) as {
      settings?: { screenshotCaptureEnabled?: boolean };
      message?: string;
      error?: string;
    };
    if (!response.ok || !body.settings) {
      throw new Error(body.message ?? body.error ?? t.messages.couldNotLoadProjectSettings);
    }
    const enabled = body.settings.screenshotCaptureEnabled === true;
    setScreenshotCaptureEnabled(enabled);
    chrome.storage.local.set({ [screenshotCaptureEnabledKey]: enabled });
  };

  const captureVisualAssets = async (annotation: Annotation, currentSelection: SelectedElement): Promise<VisualAssetPaths> =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "ui-annotations.captureVisualAssets",
          projectPath: projectPath.trim(),
          annotationId: annotation.id,
          selection: currentSelection
        },
        (response) => {
          const result = response as { ok?: boolean; paths?: VisualAssetPaths; error?: string } | undefined;
          if (result?.ok) {
            resolve(result.paths ?? {});
            return;
          }
          reject(new Error(result?.error ?? t.messages.couldNotCaptureScreenshotAssets));
        }
      );
    });

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "ui-annotations.health" }, (response) => {
      setBridgeStatus(response?.ok ? "connected" : "unavailable");
    });

    chrome.storage.local.get([selectionKey, projectPathKey, pendingAnnotationsKey, modeKey, screenshotCaptureEnabledKey], (result) => {
      const storedSelection = (result[selectionKey] as SelectedElement | undefined) ?? null;
      const storedProjectPath = (result[projectPathKey] as string | undefined) ?? "";
      const inferredProjectPath = storedSelection ? (inferProjectPathFromPageUrl(storedSelection.url) ?? "") : "";
      setSelection(storedSelection);
      setProjectPath(storedProjectPath || inferredProjectPath);
      if (!storedProjectPath && inferredProjectPath) {
        chrome.storage.local.set({ [projectPathKey]: inferredProjectPath });
      }
      if (storedProjectPath || inferredProjectPath) {
        loadSavedAnnotations(storedProjectPath || inferredProjectPath).catch((error: unknown) => {
          setSaveState("error");
          setMessage(error instanceof Error ? error.message : String(error));
        });
        loadProjectSettings(storedProjectPath || inferredProjectPath).catch((error: unknown) => {
          setSaveState("error");
          setMessage(error instanceof Error ? error.message : String(error));
        });
      }
      setScreenshotCaptureEnabled(result[screenshotCaptureEnabledKey] === true);
      setPendingAnnotations((result[pendingAnnotationsKey] as Annotation[] | undefined) ?? []);
      setAnnotationMode((result[modeKey] as AnnotationMode | undefined) ?? "idle");
    });

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "local" && changes[selectionKey]) {
        const nextSelection = (changes[selectionKey].newValue as SelectedElement | undefined) ?? null;
        const inferredProjectPath = nextSelection ? (inferProjectPathFromPageUrl(nextSelection.url) ?? "") : "";
        setSelection(nextSelection);
        if (!projectPath && inferredProjectPath) {
          setProjectPath(inferredProjectPath);
          chrome.storage.local.set({ [projectPathKey]: inferredProjectPath });
        }
        setIsSelecting(false);
        setSaveState("idle");
        setMessage("");
      }
      if (areaName === "local" && changes[pendingAnnotationsKey]) {
        setPendingAnnotations((changes[pendingAnnotationsKey].newValue as Annotation[] | undefined) ?? []);
      }
      if (areaName === "local" && changes[modeKey]) {
        const nextMode = (changes[modeKey].newValue as AnnotationMode | undefined) ?? "idle";
        setAnnotationMode(nextMode);
        setIsSelecting(nextMode === "selecting");
      }
      if (areaName === "local" && changes[screenshotCaptureEnabledKey]) {
        setScreenshotCaptureEnabled(changes[screenshotCaptureEnabledKey].newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    return () => {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  const toggleTargetPlatform = (platform: Annotation["targetPlatforms"][number]) => {
    setTargetPlatforms((current) => {
      if (current.includes(platform)) {
        const next = current.filter((item) => item !== platform);
        return next.length > 0 ? next : current;
      }
      return [...current, platform];
    });
  };

  const startSelecting = () => {
    setIsSelecting(true);
    setSaveState("idle");
    setMessage(t.messages.clickElement);
    chrome.runtime.sendMessage({ type: "ui-annotations.startSelecting" }, (response) => {
      if (!response?.ok) {
        setIsSelecting(false);
        setSaveState("error");
        setMessage(response?.error ?? t.messages.couldNotStartSelection);
      }
    });
  };

  const updateScreenshotCaptureSetting = async (enabled: boolean) => {
    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathBeforeScreenshot);
      return;
    }

    setScreenshotCaptureEnabled(enabled);
    chrome.storage.local.set({ [screenshotCaptureEnabledKey]: enabled });
    setSaveState("saving");
    setMessage(t.messages.updatingProjectSettings);
    try {
      const response = await fetch(`${bridgeUrl}/project-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath: projectPath.trim(), patch: { screenshotCaptureEnabled: enabled } })
      });
      const body = (await response.json()) as {
        settings?: { screenshotCaptureEnabled?: boolean };
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.settings) {
        throw new Error(body.message ?? body.error ?? t.messages.couldNotUpdateProjectSettings);
      }
      const nextEnabled = body.settings.screenshotCaptureEnabled === true;
      setScreenshotCaptureEnabled(nextEnabled);
      chrome.storage.local.set({ [screenshotCaptureEnabledKey]: nextEnabled });
      setSaveState("saved");
      setMessage(nextEnabled ? t.messages.screenshotEnabled : t.messages.screenshotDisabled);
    } catch (error) {
      setScreenshotCaptureEnabled(!enabled);
      chrome.storage.local.set({ [screenshotCaptureEnabledKey]: !enabled });
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveAnnotation = async () => {
    if (!selection) {
      setSaveState("error");
      setMessage(t.messages.selectElementFirst);
      return;
    }

    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathForAnnotations);
      return;
    }

    if (!note.trim()) {
      setSaveState("error");
      setMessage(t.messages.writeNoteBeforeSaving);
      return;
    }

    setSaveState("saving");
    setMessage("");
    const trimmedProjectPath = projectPath.trim();
    let annotation = createAnnotation({
      projectPath: trimmedProjectPath,
      selection,
      note: note.trim(),
      changeType,
      priority,
      targetPlatforms
    });

    try {
      if (screenshotCaptureEnabled) {
        setMessage(t.messages.capturingScreenshotAssets);
        const paths = await captureVisualAssets(annotation, selection);
        annotation = mergeVisualAssetPaths(annotation, paths);
      }
      const nextPendingAnnotations = [...pendingAnnotations, annotation];
      chrome.storage.local.set({ [projectPathKey]: trimmedProjectPath, [pendingAnnotationsKey]: nextPendingAnnotations });
      setPendingAnnotations(nextPendingAnnotations);
      setSaveState("saved");
      setMessage(t.messages.addedToPending(annotation.id));
      setNote("");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const removePendingAnnotation = (annotationId: string) => {
    const nextPendingAnnotations = pendingAnnotations.filter((annotation) => annotation.id !== annotationId);
    setPendingAnnotations(nextPendingAnnotations);
    chrome.storage.local.set({ [pendingAnnotationsKey]: nextPendingAnnotations });
  };

  const refreshSavedAnnotations = async () => {
    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathBeforeRefreshing);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.loadingSavedAnnotations);
    try {
      await loadSavedAnnotations(projectPath);
      setSaveState("saved");
      setMessage(t.messages.savedAnnotationsLoaded);
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const updateSavedAnnotationStatus = async (annotationId: string, status: EditableStatus) => {
    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathBeforeUpdating);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.updatingAnnotation(annotationId));
    try {
      const response = await fetch(`${bridgeUrl}/annotations/${encodeURIComponent(annotationId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath: projectPath.trim(), patch: { status } })
      });
      const body = (await response.json()) as { annotation?: Annotation; message?: string; error?: string };
      if (!response.ok || !body.annotation) {
        throw new Error(body.message ?? body.error ?? t.messages.couldNotUpdateAnnotation(annotationId));
      }
      setSavedAnnotations((current) => replaceAnnotation(current, body.annotation as Annotation));
      setSaveState("saved");
      setMessage(t.messages.updatedAnnotation(annotationId));
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteSavedAnnotation = async (annotationId: string) => {
    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathBeforeDeleting);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.deletingAnnotation(annotationId));
    try {
      const response = await fetch(`${bridgeUrl}/annotations/${encodeURIComponent(annotationId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath: projectPath.trim() })
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? t.messages.couldNotDeleteAnnotation(annotationId));
      }
      setSavedAnnotations((current) => removeAnnotationById(current, annotationId));
      setSelectedTaskAnnotationIds((current) => current.filter((id) => id !== annotationId));
      setSaveState("saved");
      setMessage(t.messages.deletedAnnotation(annotationId));
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveAllAnnotations = async () => {
    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathBeforeSavingList);
      return;
    }

    if (pendingAnnotations.length === 0) {
      setSaveState("error");
      setMessage(t.messages.noPendingAnnotations);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.savingAnnotations(pendingAnnotations.length));
    const trimmedProjectPath = projectPath.trim();
    try {
      for (const annotation of pendingAnnotations) {
        const response = await fetch(`${bridgeUrl}/annotations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectPath: trimmedProjectPath, annotation })
        });
        const body = (await response.json()) as { message?: string; error?: string };
        if (!response.ok) {
          throw new Error(body.message ?? body.error ?? t.messages.bridgeRejected(annotation.id));
        }
      }

      chrome.storage.local.set({ [projectPathKey]: trimmedProjectPath, [pendingAnnotationsKey]: [] });
      setPendingAnnotations([]);
      await loadSavedAnnotations(trimmedProjectPath);
      setSaveState("saved");
      setMessage(t.messages.savedAnnotationsToFiles(pendingAnnotations.length));
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleTaskAnnotation = (annotationId: string) => {
    setSelectedTaskAnnotationIds((current) =>
      current.includes(annotationId) ? current.filter((id) => id !== annotationId) : [...current, annotationId]
    );
  };

  const useTaskDefaults = () => {
    const selectedAnnotations = savedAnnotations.filter((annotation) => selectedTaskAnnotationIds.includes(annotation.id));
    if (selectedAnnotations.length === 0) {
      setSaveState("error");
      setMessage(t.messages.selectSavedForTask);
      return;
    }

    const draft = buildTaskDraft(selectedAnnotations);
    setTaskId(draft.taskId);
    setUserIntent(draft.userIntent);
    setAcceptanceCriteria(draft.acceptanceCriteria.join("\n"));
    setSaveState("idle");
    setMessage("");
  };

  const usePromptTemplate = () => {
    const selectedAnnotations = savedAnnotations.filter((annotation) => selectedTaskAnnotationIds.includes(annotation.id));
    if (selectedAnnotations.length === 0) {
      setSaveState("error");
      setMessage(t.messages.selectSavedBeforeTemplate);
      return;
    }

    const draft = applyPromptTemplate(selectedPromptTemplate, selectedAnnotations);
    setUserIntent(draft.userIntent);
    setAcceptanceCriteria(draft.acceptanceCriteria.join("\n"));
    if (!taskId.trim()) {
      setTaskId(buildTaskDraft(selectedAnnotations).taskId);
    }
    setSaveState("idle");
    setMessage("");
  };

  const createTaskPackage = async () => {
    const selectedAnnotations = savedAnnotations.filter((annotation) => selectedTaskAnnotationIds.includes(annotation.id));
    const criteria = acceptanceCriteria
      .split("\n")
      .map((criterion) => criterion.trim())
      .filter(Boolean);
    const files = suggestedFiles
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean);

    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathBeforeTask);
      return;
    }
    if (selectedAnnotations.length === 0) {
      setSaveState("error");
      setMessage(t.messages.selectSavedForTask);
      return;
    }
    if (!taskId.trim() || !userIntent.trim() || criteria.length === 0) {
      setSaveState("error");
      setMessage(t.messages.taskFieldsRequired);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.generatingTask(taskId.trim()));
    try {
      const response = await fetch(`${bridgeUrl}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectPath: projectPath.trim(),
          taskId: taskId.trim(),
          annotations: selectedAnnotations,
          userIntent: userIntent.trim(),
          acceptanceCriteria: criteria,
          ...(files.length > 0 ? { suggestedFiles: files } : {})
        })
      });
      const body = (await response.json()) as { jsonPath?: string; markdownPath?: string; message?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? t.messages.couldNotGenerateTask(taskId.trim()));
      }
      setLastGeneratedTaskId(taskId.trim());
      setAgentRunState("idle");
      setSaveState("saved");
      setMessage(t.messages.generatedTask(body.markdownPath ?? taskId.trim()));
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const sendToCodex = async () => {
    const taskIdToRun = lastGeneratedTaskId || taskId.trim();
    if (!projectPath.trim()) {
      setSaveState("error");
      setMessage(t.messages.enterProjectPathBeforeCodex);
      return;
    }
    if (!taskIdToRun) {
      setSaveState("error");
      setMessage(t.messages.generateBeforeCodex);
      return;
    }

    setSaveState("saving");
    setAgentRunState("running");
    setMessage(t.messages.sendingToCodex(taskIdToRun));
    try {
      const response = await fetch(`${bridgeUrl}/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectPath: projectPath.trim(),
          taskId: taskIdToRun,
          agent: "codex"
        })
      });
      const body = (await response.json()) as {
        run?: { runId: string; status: "completed" | "failed"; stdout?: string; stderr?: string };
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.run) {
        throw new Error(body.message ?? body.error ?? t.messages.couldNotSendToCodex(taskIdToRun));
      }

      setAgentRunState(body.run.status);
      setSaveState(body.run.status === "completed" ? "saved" : "error");
      setMessage(
        body.run.status === "completed"
          ? t.messages.codexCompleted(body.run.runId)
          : t.messages.codexFailed(body.run.runId, body.run.stderr ?? t.messages.seeRunRecord)
      );
    } catch (error) {
      setAgentRunState("failed");
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const visibleSavedAnnotations = filterAnnotations(savedAnnotations, filters);

  return (
    <main
      style={{
        background: "#0b1117",
        color: "#e8edf2",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        minHeight: "100vh",
        padding: 16
      }}
    >
      <header style={{ borderBottom: "1px solid #22303c", marginBottom: 16, paddingBottom: 12 }}>
        <h1 style={{ fontSize: 18, lineHeight: 1.2, margin: "0 0 8px" }}>{t.title}</h1>
        <div style={{ alignItems: "center", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              background: bridgeStatus === "connected" ? "rgba(52, 211, 153, 0.12)" : "rgba(249, 115, 22, 0.12)",
              border: `1px solid ${bridgeStatus === "connected" ? "#047857" : "#c2410c"}`,
              borderRadius: 999,
              color: bridgeStatus === "connected" ? "#34d399" : "#f97316",
              fontSize: 12,
              fontWeight: 800,
              padding: "4px 8px"
            }}
          >
            {t.bridgeStatus(bridgeStatus)}
          </span>
          <span
            style={{
              background: "#111a23",
              border: "1px solid #2c3a46",
              borderRadius: 999,
              color: "#cbd5e1",
              fontSize: 12,
              fontWeight: 700,
              padding: "4px 8px"
            }}
          >
            {t.shortcut}
          </span>
          <span
            style={{
              background: annotationMode === "idle" ? "#111a23" : "rgba(245, 158, 11, 0.16)",
              border: `1px solid ${annotationMode === "idle" ? "#2c3a46" : "#b45309"}`,
              borderRadius: 999,
              color: annotationMode === "idle" ? "#cbd5e1" : "#fbbf24",
              fontSize: 12,
              fontWeight: 800,
              padding: "4px 8px",
              textTransform: "capitalize"
            }}
          >
            {t.mode(annotationMode === "idle" ? t.browseMode : annotationMode)}
          </span>
        </div>
      </header>

      <section style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
          {t.projectPath}
          <input
            value={projectPath}
            onChange={(event) => {
              setProjectPath(event.target.value);
              chrome.storage.local.set({ [projectPathKey]: event.target.value });
              loadProjectSettings(event.target.value).catch(() => {
                // Settings errors are surfaced by explicit refresh or toggle actions.
              });
            }}
            placeholder="/Users/joker/Desktop/familyLocator/prototype"
            style={{
              background: "#111a23",
              border: "1px solid #2c3a46",
              borderRadius: 6,
              color: "#e8edf2",
              fontSize: 13,
              padding: "10px 12px"
            }}
          />
        </label>

        <label
          style={{
            alignItems: "center",
            background: "#101820",
            border: "1px solid #253443",
            borderRadius: 8,
            display: "grid",
            gap: 10,
            gridTemplateColumns: "auto 1fr",
            padding: 12
          }}
        >
          <input
            checked={screenshotCaptureEnabled}
            onChange={(event) => updateScreenshotCaptureSetting(event.target.checked)}
            type="checkbox"
          />
          <span style={{ display: "grid", gap: 3 }}>
            <strong style={{ fontSize: 13 }}>{t.screenshotCaptureTitle}</strong>
            <span style={{ color: "#93a4b3", fontSize: 12, lineHeight: 1.35 }}>
              {t.screenshotCaptureDescription}
            </span>
          </span>
        </label>

        <div
          style={{
            background: "#101820",
            border: "1px solid #253443",
            borderRadius: 8,
            padding: 12
          }}
        >
          <div style={{ color: "#93a4b3", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.selectedElement}</div>
          {selection ? (
            <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
              <strong style={{ color: "#f8fafc", fontSize: 14 }}>{selection.textExcerpt || selection.selector}</strong>
              <code style={{ color: "#67e8f9", overflowWrap: "anywhere" }}>{selection.selector}</code>
              <span style={{ color: "#93a4b3" }}>
                {t.boundingBoxSummary(
                  selection.boundingBox.width,
                  selection.boundingBox.height,
                  selection.boundingBox.x,
                  selection.boundingBox.y
                )}
              </span>
            </div>
          ) : (
            <p style={{ color: "#93a4b3", fontSize: 13, lineHeight: 1.4, margin: 0 }}>
              {t.selectedElementEmpty}
            </p>
          )}
        </div>

        <button
          onClick={startSelecting}
          type="button"
          style={{
            background: isSelecting ? "#f59e0b" : "#34d399",
            border: 0,
            borderRadius: 6,
            color: "#07110d",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 900,
            padding: "12px 14px"
          }}
        >
          {isSelecting ? t.selectingElement : t.selectElement}
        </button>

        <p style={{ color: "#93a4b3", fontSize: 12, lineHeight: 1.4, margin: "-4px 0 0" }}>
          {t.shortcutDescription}
        </p>

        <section
          style={{
            background: "#101820",
            border: "1px solid #253443",
            borderRadius: 8,
            display: "grid",
            gap: 10,
            padding: 12
          }}
        >
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>{t.pendingAnnotations}</h2>
            <span style={{ color: "#93a4b3", fontSize: 12 }}>{pendingAnnotations.length}</span>
          </div>
          {pendingAnnotations.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {pendingAnnotations.map((annotation) => (
                <div
                  key={annotation.id}
                  style={{
                    border: "1px solid #263746",
                    borderRadius: 6,
                    display: "grid",
                    gap: 5,
                    padding: 9
                  }}
                >
                  <strong style={{ fontSize: 13, lineHeight: 1.25 }}>
                    {annotation.anchor.dom?.textExcerpt || annotation.anchor.dom?.selector || annotation.id}
                  </strong>
                  <span style={{ color: "#93a4b3", fontSize: 12, lineHeight: 1.35 }}>{annotation.note}</span>
                  <button
                    onClick={() => removePendingAnnotation(annotation.id)}
                    type="button"
                    style={{
                      background: "transparent",
                      border: 0,
                      color: "#fca5a5",
                      cursor: "pointer",
                      fontSize: 12,
                      justifySelf: "start",
                      padding: 0
                    }}
                  >
                    {t.remove}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "#93a4b3", fontSize: 12, lineHeight: 1.4, margin: 0 }}>
              {t.pendingEmpty}
            </p>
          )}
          <button
            disabled={saveState === "saving" || pendingAnnotations.length === 0}
            onClick={saveAllAnnotations}
            type="button"
            style={{
              background: pendingAnnotations.length === 0 ? "#1c2934" : "#38bdf8",
              border: 0,
              borderRadius: 6,
              color: pendingAnnotations.length === 0 ? "#64748b" : "#07111a",
              cursor: pendingAnnotations.length === 0 ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 900,
              padding: "10px 12px"
            }}
          >
            {t.saveAllToFiles}
          </button>
        </section>

        <section
          style={{
            background: "#101820",
            border: "1px solid #253443",
            borderRadius: 8,
            display: "grid",
            gap: 10,
            padding: 12
          }}
        >
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>{t.savedAnnotations}</h2>
            <button
              onClick={refreshSavedAnnotations}
              type="button"
              style={{
                background: "#172432",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#cbd5e1",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 800,
                padding: "6px 8px"
              }}
            >
              {t.refresh}
            </button>
          </div>

          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <input
              aria-label={t.searchSavedAnnotations}
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder={t.search}
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 12,
                padding: "8px 9px"
              }}
            />
            <select
              aria-label={t.filterByStatus}
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value as AnnotationFilters["status"] }))
              }
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 12,
                padding: "8px 9px"
              }}
            >
              <option value="all">{t.allStatus}</option>
              <option value="open">{t.statuses.open}</option>
              <option value="drafted">{t.statuses.drafted}</option>
              <option value="sent-to-codex">{t.statuses["sent-to-codex"]}</option>
              <option value="resolved">{t.statuses.resolved}</option>
            </select>
            <select
              aria-label={t.filterByPriority}
              value={filters.priority}
              onChange={(event) =>
                setFilters((current) => ({ ...current, priority: event.target.value as AnnotationFilters["priority"] }))
              }
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 12,
                padding: "8px 9px"
              }}
            >
              <option value="all">{t.allPriority}</option>
              <option value="low">{t.priorities.low}</option>
              <option value="medium">{t.priorities.medium}</option>
              <option value="high">{t.priorities.high}</option>
            </select>
            <select
              aria-label={t.filterByTargetPlatform}
              value={filters.targetPlatform}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  targetPlatform: event.target.value as AnnotationFilters["targetPlatform"]
                }))
              }
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 12,
                padding: "8px 9px"
              }}
            >
              <option value="all">{t.allTargets}</option>
              <option value="web">{t.targets.web}</option>
              <option value="ios-swiftui">{t.targets["ios-swiftui"]}</option>
            </select>
          </div>

          {visibleSavedAnnotations.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {visibleSavedAnnotations.map((annotation) => (
                <div
                  key={annotation.id}
                  style={{
                    border: "1px solid #263746",
                    borderRadius: 6,
                    display: "grid",
                    gap: 8,
                    padding: 9
                  }}
                >
                  <label style={{ alignItems: "start", display: "grid", gap: 8, gridTemplateColumns: "18px 1fr" }}>
                    <input
                      checked={selectedTaskAnnotationIds.includes(annotation.id)}
                      onChange={() => toggleTaskAnnotation(annotation.id)}
                      style={{ marginTop: 2 }}
                      type="checkbox"
                    />
                    <span style={{ display: "grid", gap: 4 }}>
                      <strong style={{ fontSize: 13, lineHeight: 1.25 }}>
                        {annotation.anchor.dom?.textExcerpt || annotation.anchor.dom?.selector || annotation.id}
                      </strong>
                      <span style={{ color: "#93a4b3", fontSize: 12, lineHeight: 1.35 }}>{annotation.note}</span>
                      <code style={{ color: "#67e8f9", fontSize: 11, overflowWrap: "anywhere" }}>{annotation.id}</code>
                    </span>
                  </label>
                  <div style={{ alignItems: "center", display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                    <select
                      aria-label={`${t.filterByStatus} ${annotation.id}`}
                      value={annotation.status === "deleted" ? "open" : annotation.status}
                      onChange={(event) =>
                        updateSavedAnnotationStatus(annotation.id, event.target.value as EditableStatus)
                      }
                      style={{
                        background: "#111a23",
                        border: "1px solid #2c3a46",
                        borderRadius: 6,
                        color: "#e8edf2",
                        fontSize: 12,
                        padding: "7px 8px"
                      }}
                    >
                      <option value="open">{t.statuses.open}</option>
                      <option value="drafted">{t.statuses.drafted}</option>
                      <option value="sent-to-codex">{t.statuses["sent-to-codex"]}</option>
                      <option value="resolved">{t.statuses.resolved}</option>
                    </select>
                    <button
                      onClick={() => deleteSavedAnnotation(annotation.id)}
                      type="button"
                      style={{
                        background: "transparent",
                        border: "1px solid #7f1d1d",
                        borderRadius: 6,
                        color: "#fca5a5",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "7px 8px"
                      }}
                    >
                      {t.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "#93a4b3", fontSize: 12, lineHeight: 1.4, margin: 0 }}>
              {t.savedEmpty}
            </p>
          )}
        </section>

        <section
          style={{
            background: "#101820",
            border: "1px solid #253443",
            borderRadius: 8,
            display: "grid",
            gap: 10,
            padding: 12
          }}
        >
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>{t.taskPackage}</h2>
            <span style={{ color: "#93a4b3", fontSize: 12 }}>{t.selectedCount(selectedTaskAnnotationIds.length)}</span>
          </div>
          <button
            disabled={selectedTaskAnnotationIds.length === 0}
            onClick={useTaskDefaults}
            type="button"
            style={{
              background: selectedTaskAnnotationIds.length === 0 ? "#1c2934" : "#facc15",
              border: 0,
              borderRadius: 6,
              color: selectedTaskAnnotationIds.length === 0 ? "#64748b" : "#16120a",
              cursor: selectedTaskAnnotationIds.length === 0 ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 900,
              padding: "9px 10px"
            }}
          >
            {t.draftFromSelection}
          </button>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
            <select
              aria-label={t.promptTemplate}
              value={selectedPromptTemplate}
              onChange={(event) => setSelectedPromptTemplate(event.target.value as PromptTemplateId)}
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 13,
                padding: "9px 10px"
              }}
            >
              {promptTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {t.promptTemplates[template.id] ?? template.label}
                </option>
              ))}
            </select>
            <button
              disabled={selectedTaskAnnotationIds.length === 0}
              onClick={usePromptTemplate}
              type="button"
              style={{
                background: selectedTaskAnnotationIds.length === 0 ? "#1c2934" : "#facc15",
                border: 0,
                borderRadius: 6,
                color: selectedTaskAnnotationIds.length === 0 ? "#64748b" : "#16120a",
                cursor: selectedTaskAnnotationIds.length === 0 ? "not-allowed" : "pointer",
                fontSize: 13,
                fontWeight: 900,
                padding: "9px 10px"
              }}
            >
              {t.apply}
            </button>
          </div>
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            {t.taskId}
            <input
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
              placeholder="task_ann_001"
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 13,
                padding: "9px 10px"
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            {t.userIntent}
            <textarea
              value={userIntent}
              onChange={(event) => setUserIntent(event.target.value)}
              placeholder={t.userIntentPlaceholder}
              rows={4}
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 13,
                lineHeight: 1.4,
                padding: "9px 10px",
                resize: "vertical"
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            {t.acceptanceCriteria}
            <textarea
              value={acceptanceCriteria}
              onChange={(event) => setAcceptanceCriteria(event.target.value)}
              placeholder={t.acceptanceCriteriaPlaceholder}
              rows={4}
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 13,
                lineHeight: 1.4,
                padding: "9px 10px",
                resize: "vertical"
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            {t.suggestedFiles}
            <textarea
              value={suggestedFiles}
              onChange={(event) => setSuggestedFiles(event.target.value)}
              placeholder={t.suggestedFilesPlaceholder}
              rows={3}
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                fontSize: 13,
                lineHeight: 1.4,
                padding: "9px 10px",
                resize: "vertical"
              }}
            />
          </label>
          <button
            disabled={saveState === "saving"}
            onClick={createTaskPackage}
            type="button"
            style={{
              background: saveState === "saving" ? "#1f2937" : "#38bdf8",
              border: 0,
              borderRadius: 6,
              color: saveState === "saving" ? "#64748b" : "#07111a",
              cursor: saveState === "saving" ? "wait" : "pointer",
              fontSize: 14,
              fontWeight: 900,
              padding: "10px 12px"
            }}
          >
            {t.generateTaskFiles}
          </button>
          <button
            disabled={saveState === "saving" || !(lastGeneratedTaskId || taskId.trim())}
            onClick={sendToCodex}
            type="button"
            style={{
              background: !(lastGeneratedTaskId || taskId.trim()) ? "#1c2934" : "#34d399",
              border: 0,
              borderRadius: 6,
              color: !(lastGeneratedTaskId || taskId.trim()) ? "#64748b" : "#07110d",
              cursor: saveState === "saving" || !(lastGeneratedTaskId || taskId.trim()) ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 900,
              padding: "10px 12px"
            }}
          >
            {agentRunState === "running" ? t.codexRunning : t.sendToCodex}
          </button>
        </section>

        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
          {t.note}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t.notePlaceholder}
            rows={5}
            style={{
              background: "#111a23",
              border: "1px solid #2c3a46",
              borderRadius: 6,
              color: "#e8edf2",
              fontSize: 13,
              lineHeight: 1.4,
              padding: "10px 12px",
              resize: "vertical"
            }}
          />
        </label>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            {t.type}
            <select
              value={changeType}
              onChange={(event) => setChangeType(event.target.value as Annotation["changeType"])}
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                padding: "9px 10px"
              }}
            >
              <option value="layout">{t.changeTypes.layout}</option>
              <option value="copy">{t.changeTypes.copy}</option>
              <option value="color">{t.changeTypes.color}</option>
              <option value="state">{t.changeTypes.state}</option>
              <option value="navigation">{t.changeTypes.navigation}</option>
              <option value="platform-parity">{t.changeTypes["platform-parity"]}</option>
              <option value="other">{t.changeTypes.other}</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            {t.priority}
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Annotation["priority"])}
              style={{
                background: "#111a23",
                border: "1px solid #2c3a46",
                borderRadius: 6,
                color: "#e8edf2",
                padding: "9px 10px"
              }}
            >
              <option value="low">{t.priorities.low}</option>
              <option value="medium">{t.priorities.medium}</option>
              <option value="high">{t.priorities.high}</option>
            </select>
          </label>
        </div>

        <fieldset style={{ border: "1px solid #253443", borderRadius: 8, margin: 0, padding: 12 }}>
          <legend style={{ color: "#93a4b3", fontSize: 12, fontWeight: 700 }}>{t.targetsLegend}</legend>
          <label style={{ alignItems: "center", display: "flex", gap: 8, fontSize: 13, marginTop: 4 }}>
            <input
              checked={targetPlatforms.includes("web")}
              onChange={() => toggleTargetPlatform("web")}
              type="checkbox"
            />
            {t.targets.web}
          </label>
          <label style={{ alignItems: "center", display: "flex", gap: 8, fontSize: 13, marginTop: 8 }}>
            <input
              checked={targetPlatforms.includes("ios-swiftui")}
              onChange={() => toggleTargetPlatform("ios-swiftui")}
              type="checkbox"
            />
            {t.targets["ios-swiftui"]}
          </label>
        </fieldset>

        <button
          disabled={saveState === "saving"}
          onClick={saveAnnotation}
          type="button"
          style={{
            background: saveState === "saving" ? "#1f2937" : "#34d399",
            border: 0,
            borderRadius: 6,
            color: "#07110d",
            cursor: saveState === "saving" ? "wait" : "pointer",
            fontSize: 14,
            fontWeight: 800,
            padding: "12px 14px"
          }}
        >
          {saveState === "saving" ? t.saving : t.addToPendingList}
        </button>

        {message ? (
          <p style={{ color: saveState === "error" ? "#fca5a5" : "#86efac", fontSize: 13, lineHeight: 1.4, margin: 0 }}>
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
