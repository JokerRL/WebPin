import { useEffect, useRef, useState } from "react";
import type { Annotation } from "@ui-annotations/shared";
import type { SelectedElement } from "../content";
import { createAnnotationFromSelection } from "../annotation-factory";
import { BridgeClientError, createBridgeClient, type BridgeClient } from "../bridge-client";
import { clearCredentialsIfCurrent } from "../credential-cleanup";
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
import {
  accessKeyStorageKey,
  legacyProjectPathStorageKey,
  projectNameStorageKey,
  type ConnectionState
} from "./connection";
import { savePendingSequentially } from "./pending-save";
import { findProjectMismatch } from "./project-association";
import { createLatestAttemptGate } from "./latest-attempt";

const selectionKey = "ui-annotations.lastSelection";
const pendingAnnotationsKey = "ui-annotations.pendingAnnotations";
const modeKey = "ui-annotations.mode";
const screenshotCaptureEnabledKey = "ui-annotations.screenshotCaptureEnabled";

type SaveState = "idle" | "saving" | "saved" | "error";
type AnnotationMode = "idle" | "selecting" | "editing";
type EditableStatus = Exclude<Annotation["status"], "deleted">;

export function App() {
  const t = panelText[getPanelLanguage()];
  const [connection, setConnection] = useState<ConnectionState>({ status: "offline" });
  const [accessKeyInput, setAccessKeyInput] = useState("");
  const [activeAccessKey, setActiveAccessKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selection, setSelection] = useState<SelectedElement | null>(null);
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
  const [isPendingSaveInProgress, setIsPendingSaveInProgress] = useState(false);
  const attemptGateRef = useRef(createLatestAttemptGate());
  const activeAccessKeyRef = useRef("");

  const clearAuthentication = async (rejectedAccessKey: string) => {
    if (activeAccessKeyRef.current && activeAccessKeyRef.current !== rejectedAccessKey) return false;
    const attempt = attemptGateRef.current.begin();
    const cleared = await clearCredentialsIfCurrent(chrome.storage.local, rejectedAccessKey);
    if (!attemptGateRef.current.isLatest(attempt)) return false;
    if (!cleared) return false;
    if (!attemptGateRef.current.isLatest(attempt)) return;
    activeAccessKeyRef.current = "";
    setAccessKeyInput("");
    setActiveAccessKey("");
    setProjectName("");
    setConnection({ status: "key-required" });
    return true;
  };

  const handleAuthenticatedError = async (
    error: unknown,
    fallback: string,
    rejectedAccessKey = activeAccessKey
  ) => {
    setSaveState("error");
    if (error instanceof BridgeClientError && error.kind === "auth") {
      try {
        await clearAuthentication(rejectedAccessKey);
      } catch {
        // Keep the current session state if credential cleanup could not be persisted.
      }
      setMessage(t.messages.accessKeyRejected);
      return;
    }
    if (error instanceof BridgeClientError && error.kind === "offline") {
      setConnection({ status: "offline" });
      setMessage(t.messages.bridgeOffline);
      return;
    }
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const loadSavedAnnotations = async (client: BridgeClient, shouldApply: () => boolean = () => true) => {
    const { annotations } = await client.listAnnotations();
    if (!shouldApply()) return;
    setSavedAnnotations(annotations);
    setSelectedTaskAnnotationIds((current) =>
      current.filter((annotationId) => annotations.some((annotation) => annotation.id === annotationId))
    );
  };

  const loadProjectSettings = async (client: BridgeClient, shouldApply: () => boolean = () => true) => {
    const { settings } = await client.getProjectSettings();
    if (!shouldApply()) return;
    const enabled = settings.screenshotCaptureEnabled === true;
    await chrome.storage.local.set({ [screenshotCaptureEnabledKey]: enabled });
    if (!shouldApply()) return;
    setScreenshotCaptureEnabled(enabled);
  };

  const pendingMessage = async (
    type:
      | "ui-annotations.getPendingAnnotations"
      | "ui-annotations.appendPendingAnnotation"
      | "ui-annotations.acknowledgePendingAnnotation"
      | "ui-annotations.removePendingAnnotation",
    payload: Record<string, unknown> = {}
  ): Promise<Annotation[]> => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const result = response as {
        ok?: boolean;
        pendingAnnotations?: Annotation[];
        error?: string;
        kind?: BridgeClientError["kind"];
      } | undefined;
      if (result?.ok) {
        resolve(result.pendingAnnotations ?? []);
        return;
      }
      reject(result?.kind
        ? new BridgeClientError(result.kind, result.error ?? "Bridge request failed.")
        : new Error(result?.error ?? "Pending annotation update failed."));
    });
  });

  const captureVisualAssets = async (annotation: Annotation, currentSelection: SelectedElement): Promise<VisualAssetPaths> =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "ui-annotations.captureVisualAssets",
          annotationId: annotation.id,
          selection: currentSelection
        },
        (response) => {
          const result = response as {
            ok?: boolean;
            paths?: VisualAssetPaths;
            error?: string;
            kind?: BridgeClientError["kind"];
          } | undefined;
          if (result?.ok) {
            resolve(result.paths ?? {});
            return;
          }
          reject(result?.kind
            ? new BridgeClientError(result.kind, result.error ?? t.messages.couldNotCaptureScreenshotAssets)
            : new Error(result?.error ?? t.messages.couldNotCaptureScreenshotAssets));
        }
      );
    });

  useEffect(() => {
    const startupAttempt = attemptGateRef.current.begin();
    chrome.storage.local.get([
      selectionKey,
      accessKeyStorageKey,
      projectNameStorageKey,
      modeKey,
      screenshotCaptureEnabledKey
    ], (result) => {
      if (!attemptGateRef.current.isLatest(startupAttempt)) return;
      const storedSelection = (result[selectionKey] as SelectedElement | undefined) ?? null;
      const storedAccessKey = String(result[accessKeyStorageKey] ?? "").trim();
      setSelection(storedSelection);
      setAccessKeyInput(storedAccessKey);
      setScreenshotCaptureEnabled(result[screenshotCaptureEnabledKey] === true);
      setAnnotationMode((result[modeKey] as AnnotationMode | undefined) ?? "idle");

      pendingMessage("ui-annotations.getPendingAnnotations")
        .then((latest) => {
          if (attemptGateRef.current.isLatest(startupAttempt)) setPendingAnnotations(latest);
        })
        .catch(() => {
          // The storage change listener will still receive future background-owned mutations.
        });

      const client = createBridgeClient({ accessKey: storedAccessKey });
      client.getHealth()
        .then(async () => {
          if (!attemptGateRef.current.isLatest(startupAttempt)) return;
          if (!storedAccessKey) {
            setConnection({ status: "key-required" });
            return;
          }
          try {
            const session = await client.getSession();
            if (!attemptGateRef.current.isLatest(startupAttempt)) return;
            setConnection({ status: "ready", projectName: session.projectName });
            activeAccessKeyRef.current = storedAccessKey;
            setActiveAccessKey(storedAccessKey);
            setProjectName(session.projectName);
            const shouldApply = () => attemptGateRef.current.isLatest(startupAttempt);
            await Promise.all([loadSavedAnnotations(client, shouldApply), loadProjectSettings(client, shouldApply)]);
            if (!attemptGateRef.current.isLatest(startupAttempt)) return;
          } catch (error) {
            if (!attemptGateRef.current.isLatest(startupAttempt)) return;
            await handleAuthenticatedError(error, t.messages.couldNotLoadSavedAnnotations, storedAccessKey);
          }
        })
        .catch(async (error) => {
          if (!attemptGateRef.current.isLatest(startupAttempt)) return;
          await handleAuthenticatedError(error, t.messages.bridgeOffline);
        });
    });

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "local" && changes[selectionKey]) {
        const nextSelection = (changes[selectionKey].newValue as SelectedElement | undefined) ?? null;
        setSelection(nextSelection);
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
      if (areaName === "local" && changes[accessKeyStorageKey] && !changes[accessKeyStorageKey].newValue) {
        attemptGateRef.current.invalidate();
        setAccessKeyInput("");
        activeAccessKeyRef.current = "";
        setActiveAccessKey("");
        setProjectName("");
        setConnection({ status: "key-required" });
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    return () => {
      attemptGateRef.current.invalidate();
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

  const connectBridge = async () => {
    const attempt = attemptGateRef.current.begin();
    const accessKey = accessKeyInput.trim();
    if (!accessKey) {
      setConnection({ status: "key-required" });
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
      return;
    }

    setSaveState("saving");
    try {
      const client = createBridgeClient({ accessKey });
      const session = await client.getSession();
      if (!attemptGateRef.current.isLatest(attempt)) return;
      await chrome.storage.local.set({
        [accessKeyStorageKey]: accessKey,
        [projectNameStorageKey]: session.projectName
      });
      if (!attemptGateRef.current.isLatest(attempt)) return;
      await chrome.storage.local.remove(legacyProjectPathStorageKey);
      if (!attemptGateRef.current.isLatest(attempt)) return;
      setActiveAccessKey(accessKey);
      activeAccessKeyRef.current = accessKey;
      setProjectName(session.projectName);
      setConnection({ status: "ready", projectName: session.projectName });
      const shouldApply = () => attemptGateRef.current.isLatest(attempt);
      await Promise.all([loadSavedAnnotations(client, shouldApply), loadProjectSettings(client, shouldApply)]);
      if (!attemptGateRef.current.isLatest(attempt)) return;
      setSaveState("saved");
      setMessage(t.messages.bridgeReady(session.projectName));
    } catch (error) {
      if (!attemptGateRef.current.isLatest(attempt)) return;
      await handleAuthenticatedError(error, t.messages.bridgeOffline, accessKey);
    }
  };

  const updateScreenshotCaptureSetting = async (enabled: boolean) => {
    if (connection.status !== "ready") {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
      return;
    }

    const previousEnabled = screenshotCaptureEnabled;
    setSaveState("saving");
    setMessage(t.messages.updatingProjectSettings);
    let remoteUpdated = false;
    try {
      const client = createBridgeClient({ accessKey: activeAccessKey });
      const { settings } = await client
        .updateProjectSettings(enabled);
      remoteUpdated = true;
      const nextEnabled = settings.screenshotCaptureEnabled === true;
      await chrome.storage.local.set({ [screenshotCaptureEnabledKey]: nextEnabled });
      setScreenshotCaptureEnabled(nextEnabled);
      setSaveState("saved");
      setMessage(nextEnabled ? t.messages.screenshotEnabled : t.messages.screenshotDisabled);
    } catch (error) {
      setScreenshotCaptureEnabled(previousEnabled);
      if (remoteUpdated) {
        try {
          await createBridgeClient({ accessKey: activeAccessKey }).updateProjectSettings(previousEnabled);
          await chrome.storage.local.set({ [screenshotCaptureEnabledKey]: previousEnabled });
        } catch (rollbackError) {
          await handleAuthenticatedError(rollbackError, t.messages.couldNotUpdateProjectSettings);
          return;
        }
      }
      await handleAuthenticatedError(error, t.messages.couldNotUpdateProjectSettings);
    }
  };

  const saveAnnotation = async () => {
    if (!selection) {
      setSaveState("error");
      setMessage(t.messages.selectElementFirst);
      return;
    }

    if (connection.status !== "ready" || !projectName) {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
      return;
    }

    if (!note.trim()) {
      setSaveState("error");
      setMessage(t.messages.writeNoteBeforeSaving);
      return;
    }

    setSaveState("saving");
    setMessage("");
    let annotation = createAnnotationFromSelection({
      projectName,
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
      const latest = await pendingMessage("ui-annotations.appendPendingAnnotation", { annotation });
      setPendingAnnotations(latest);
      setSaveState("saved");
      setMessage(t.messages.addedToPending(annotation.id));
      setNote("");
    } catch (error) {
      await handleAuthenticatedError(error, t.messages.couldNotCaptureScreenshotAssets);
    }
  };

  const removePendingAnnotation = async (annotationId: string) => {
    if (isPendingSaveInProgress) return;
    try {
      const latest = await pendingMessage("ui-annotations.removePendingAnnotation", { annotationId });
      setPendingAnnotations(latest);
    } catch (error) {
      await handleAuthenticatedError(error, t.messages.bridgeRejected(annotationId));
    }
  };

  const refreshSavedAnnotations = async () => {
    if (connection.status !== "ready") {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.loadingSavedAnnotations);
    try {
      await loadSavedAnnotations(createBridgeClient({ accessKey: activeAccessKey }));
      setSaveState("saved");
      setMessage(t.messages.savedAnnotationsLoaded);
    } catch (error) {
      await handleAuthenticatedError(error, t.messages.couldNotLoadSavedAnnotations);
    }
  };

  const updateSavedAnnotationStatus = async (annotationId: string, status: EditableStatus) => {
    if (connection.status !== "ready") {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.updatingAnnotation(annotationId));
    try {
      const { annotation } = await createBridgeClient({ accessKey: activeAccessKey })
        .updateAnnotation(annotationId, { status });
      setSavedAnnotations((current) => replaceAnnotation(current, annotation));
      setSaveState("saved");
      setMessage(t.messages.updatedAnnotation(annotationId));
    } catch (error) {
      await handleAuthenticatedError(error, t.messages.couldNotUpdateAnnotation(annotationId));
    }
  };

  const deleteSavedAnnotation = async (annotationId: string) => {
    if (connection.status !== "ready") {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
      return;
    }

    setSaveState("saving");
    setMessage(t.messages.deletingAnnotation(annotationId));
    try {
      await createBridgeClient({ accessKey: activeAccessKey }).deleteAnnotation(annotationId);
      setSavedAnnotations((current) => removeAnnotationById(current, annotationId));
      setSelectedTaskAnnotationIds((current) => current.filter((id) => id !== annotationId));
      setSaveState("saved");
      setMessage(t.messages.deletedAnnotation(annotationId));
    } catch (error) {
      await handleAuthenticatedError(error, t.messages.couldNotDeleteAnnotation(annotationId));
    }
  };

  const saveAllAnnotations = async () => {
    if (connection.status !== "ready") {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
      return;
    }

    if (pendingAnnotations.length === 0) {
      setSaveState("error");
      setMessage(t.messages.noPendingAnnotations);
      return;
    }

    const mismatch = findProjectMismatch(pendingAnnotations, projectName);
    if (mismatch) {
      setSaveState("error");
      setMessage(t.messages.pendingProjectMismatch);
      return;
    }

    setIsPendingSaveInProgress(true);
    setSaveState("saving");
    setMessage(t.messages.savingAnnotations(pendingAnnotations.length));
    const savedCount = pendingAnnotations.length;
    const client = createBridgeClient({ accessKey: activeAccessKey });
    try {
      await savePendingSequentially(
        pendingAnnotations,
        async (annotation) => {
          await client.createAnnotation(annotation);
        },
        async (acknowledged) => {
          const latest = await pendingMessage("ui-annotations.acknowledgePendingAnnotation", {
            annotationId: acknowledged.id
          });
          setPendingAnnotations(latest);
        }
      );
      await loadSavedAnnotations(client);
      setSaveState("saved");
      setMessage(t.messages.savedAnnotationsToFiles(savedCount));
    } catch (error) {
      await handleAuthenticatedError(error, t.messages.bridgeRejected("annotation"));
    } finally {
      setIsPendingSaveInProgress(false);
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

    if (connection.status !== "ready") {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
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
      const body = await createBridgeClient({ accessKey: activeAccessKey }).createTask({
        taskId: taskId.trim(),
        annotations: selectedAnnotations,
        userIntent: userIntent.trim(),
        acceptanceCriteria: criteria,
        ...(files.length > 0 ? { suggestedFiles: files } : {})
      });
      setLastGeneratedTaskId(taskId.trim());
      setAgentRunState("idle");
      setSaveState("saved");
      setMessage(t.messages.generatedTask(body.markdownPath ?? taskId.trim()));
    } catch (error) {
      await handleAuthenticatedError(error, t.messages.couldNotGenerateTask(taskId.trim()));
    }
  };

  const sendToCodex = async () => {
    const taskIdToRun = lastGeneratedTaskId || taskId.trim();
    if (connection.status !== "ready") {
      setSaveState("error");
      setMessage(t.messages.accessKeyRejected);
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
      const body = await createBridgeClient({ accessKey: activeAccessKey }).runAgent(taskIdToRun);

      setAgentRunState(body.run.status);
      setSaveState(body.run.status === "completed" ? "saved" : "error");
      setMessage(
        body.run.status === "completed"
          ? t.messages.codexCompleted(body.run.runId)
          : t.messages.codexFailed(body.run.runId, t.messages.seeRunRecord)
      );
    } catch (error) {
      setAgentRunState("failed");
      await handleAuthenticatedError(error, t.messages.couldNotSendToCodex(taskIdToRun));
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
            role="status"
            aria-live="polite"
            style={{
              background: connection.status === "ready" ? "rgba(52, 211, 153, 0.12)" : "rgba(249, 115, 22, 0.12)",
              border: `1px solid ${connection.status === "ready" ? "#047857" : "#c2410c"}`,
              borderRadius: 999,
              color: connection.status === "ready" ? "#34d399" : "#f97316",
              fontSize: 12,
              fontWeight: 800,
              padding: "4px 8px"
            }}
          >
            {t.bridgeStatus(t.connectionStatuses[connection.status])}
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
          {t.accessKey}
          <input
            type="password"
            value={accessKeyInput}
            onChange={(event) => setAccessKeyInput(event.target.value)}
            placeholder={t.accessKeyPlaceholder}
            autoComplete="off"
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
        <button type="button" onClick={connectBridge} disabled={saveState === "saving"}>
          {t.connectBridge}
        </button>

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
            disabled={connection.status !== "ready"}
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
                    disabled={isPendingSaveInProgress}
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
            disabled={
              connection.status !== "ready" ||
              saveState === "saving" ||
              isPendingSaveInProgress ||
              pendingAnnotations.length === 0
            }
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
              disabled={connection.status !== "ready"}
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
                      disabled={connection.status !== "ready"}
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
                      disabled={connection.status !== "ready"}
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
                      disabled={connection.status !== "ready"}
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
            disabled={connection.status !== "ready" || selectedTaskAnnotationIds.length === 0}
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
              disabled={connection.status !== "ready" || selectedTaskAnnotationIds.length === 0}
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
            disabled={connection.status !== "ready" || saveState === "saving"}
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
            disabled={connection.status !== "ready" || saveState === "saving" || !(lastGeneratedTaskId || taskId.trim())}
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
          disabled={connection.status !== "ready" || saveState === "saving" || isPendingSaveInProgress}
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
          <p
            role="status"
            aria-live="polite"
            style={{ color: saveState === "error" ? "#fca5a5" : "#86efac", fontSize: 13, lineHeight: 1.4, margin: 0 }}
          >
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
