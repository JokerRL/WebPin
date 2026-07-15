export type SelectedElement = {
  url: string;
  route?: string;
  title?: string;
  selector: string;
  xpath: string;
  textExcerpt: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number; deviceScaleFactor: number };
};

const installedOverlays = new WeakMap<Document, HTMLDivElement>();
const annotationUiAttribute = "data-ui-annotations-root";
type InteractionMode = "idle" | "selecting" | "editing";
type ModeMessage = {
  commandId?: string;
  type?: unknown;
};
type ChromeRuntimeApi = {
  lastError?: { message?: string };
  sendMessage?: (message: unknown, callback?: (response: unknown) => void) => void;
  onMessage?: {
    addListener?: (listener: (message: unknown) => void) => void;
  };
};

declare const chrome:
  | {
      runtime?: ChromeRuntimeApi;
    }
  | undefined;

function runtimeApi(): ChromeRuntimeApi | null {
  try {
    return typeof chrome !== "undefined" ? (chrome.runtime ?? null) : null;
  } catch {
    return null;
  }
}

function sendRuntimeMessageSafely(message: unknown, callback?: (response: unknown) => void): void {
  const runtime = runtimeApi();
  if (!runtime?.sendMessage) {
    callback?.(undefined);
    return;
  }

  try {
    runtime.sendMessage(message, (response) => {
      void runtime.lastError;
      callback?.(response);
    });
  } catch {
    callback?.(undefined);
  }
}

function cssEscape(value: string): string {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function routeFromLocation(location: Location): string | undefined {
  if (location.protocol === "file:") {
    return location.hash || location.pathname.split("/").at(-1) || undefined;
  }

  const route = `${location.pathname}${location.hash}`;
  return route || undefined;
}

function textExcerpt(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

export function selectorForElement(element: Element): string {
  const testId = element.getAttribute("data-testid");
  if (testId) {
    return `[data-testid="${cssEscape(testId)}"]`;
  }

  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === 1 && current !== current.ownerDocument.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const currentTagName = current.tagName;
    const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === currentTagName);
    if (sameTagSiblings.length === 1) {
      parts.unshift(tag);
    } else {
      parts.unshift(`${tag}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`);
    }

    current = parent;
  }

  return parts.join(" > ");
}

export function xpathForElement(element: Element): string {
  if (element.id) {
    return `//*[@id="${element.id.replace(/"/g, '\\"')}"]`;
  }

  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === 1) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  return `/${segments.join("/")}`;
}

export function selectedElementFromTarget(element: Element, win: Window = window): SelectedElement {
  const rect = element.getBoundingClientRect();
  const route = routeFromLocation(win.location);
  return {
    url: win.location.href,
    ...(route ? { route } : {}),
    ...(win.document.title ? { title: win.document.title } : {}),
    selector: selectorForElement(element),
    xpath: xpathForElement(element),
    textExcerpt: textExcerpt(element),
    boundingBox: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    viewport: {
      width: win.innerWidth,
      height: win.innerHeight,
      deviceScaleFactor: win.devicePixelRatio || 1
    }
  };
}

export function installAnnotationOverlay(doc: Document = document): HTMLDivElement {
  const existingOverlay = installedOverlays.get(doc);
  if (existingOverlay) {
    return existingOverlay;
  }

  const overlay = doc.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "2147483647";
  overlay.style.border = "2px solid #22c55e";
  overlay.style.borderRadius = "6px";
  overlay.style.display = "none";
  doc.documentElement.appendChild(overlay);
  let mode: InteractionMode = "idle";
  let activeSelection: SelectedElement | null = null;
  let editor: HTMLFormElement | null = null;
  let toast: HTMLDivElement | null = null;
  let toastTimeout: number | undefined;
  const handledCommandIds = new Set<string>();

  function updateOverlay(target: Element): void {
    const rect = target.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.display = "block";
  }

  function removeEditor(): void {
    editor?.remove();
    editor = null;
  }

  function hideOverlay(): void {
    overlay.style.display = "none";
  }

  function modeLabel(nextMode: InteractionMode): string {
    if (nextMode === "selecting") {
      return "Annotation mode on";
    }

    if (nextMode === "editing") {
      return "Editing annotation";
    }

    return "Annotation mode off";
  }

  function showModeToast(nextMode: InteractionMode): void {
    const win = doc.defaultView ?? window;
    if (!toast) {
      toast = doc.createElement("div");
      toast.setAttribute("data-ui-annotations-toast", "true");
      toast.style.position = "fixed";
      toast.style.left = "50%";
      toast.style.top = "16px";
      toast.style.transform = "translateX(-50%)";
      toast.style.zIndex = "2147483647";
      toast.style.background = nextMode === "idle" ? "#172330" : "#0f766e";
      toast.style.border = "1px solid #2dd4bf";
      toast.style.borderRadius = "999px";
      toast.style.boxShadow = "0 12px 32px rgba(0, 0, 0, 0.32)";
      toast.style.color = "#f8fafc";
      toast.style.font = "800 13px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      toast.style.padding = "8px 12px";
      toast.style.pointerEvents = "none";
      doc.documentElement.appendChild(toast);
    }

    toast.style.background = nextMode === "idle" ? "#172330" : "#0f766e";
    toast.textContent = modeLabel(nextMode);
    toast.style.display = "block";
    if (toastTimeout) {
      win.clearTimeout(toastTimeout);
    }
    toastTimeout = win.setTimeout(() => {
      if (toast) {
        toast.style.display = "none";
      }
    }, 1400);
  }

  function notifyModeChanged(nextMode: InteractionMode): void {
    sendRuntimeMessageSafely({
      type: "ui-annotations.modeChanged",
      mode: nextMode
    });
  }

  function setMode(nextMode: InteractionMode): void {
    if (mode === nextMode) {
      return;
    }

    mode = nextMode;
    if (mode !== "selecting") {
      hideOverlay();
    }
    if (mode !== "editing") {
      removeEditor();
    }
    showModeToast(mode);
    notifyModeChanged(mode);
  }

  function targetFromPoint(event: MouseEvent): Element | null {
    const win = doc.defaultView ?? window;
    const elements = doc.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    return (
      elements.find((element) => {
        if (element === overlay || element === doc.documentElement || element === doc.body) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) ??
      (event.target instanceof win.Element && event.target !== overlay ? event.target : null)
    );
  }

  doc.addEventListener(
    "mousemove",
    (event) => {
      if (mode !== "selecting" || !(event instanceof MouseEvent)) {
        return;
      }

      const target = targetFromPoint(event);
      if (target) {
        updateOverlay(target);
      }
    },
    { passive: true }
  );

  function isInsideAnnotationUi(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest(`[${annotationUiAttribute}]`));
  }

  function blockEditingEvent(event: MouseEvent): boolean {
    if (mode !== "editing" || isInsideAnnotationUi(event.target)) {
      return false;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  function swallowSelectionEvent(event: MouseEvent): Element | null {
    if (mode !== "selecting") {
      return null;
    }

    const target = targetFromPoint(event);
    if (!target) {
      return null;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    return target;
  }

  function sendSelection(target: Element): void {
    activeSelection = selectedElementFromTarget(target, doc.defaultView ?? window);
    sendRuntimeMessageSafely({
      type: "ui-annotations.elementSelected",
      selection: activeSelection
    });
  }

  function editorPositionForSelection(selection: SelectedElement): { left: number; top: number } {
    const win = doc.defaultView ?? window;
    const margin = 10;
    const width = 300;
    const left = Math.min(Math.max(selection.boundingBox.x + selection.boundingBox.width + margin, margin), win.innerWidth - width - margin);
    const top = Math.min(Math.max(selection.boundingBox.y, margin), win.innerHeight - 260);
    return { left, top };
  }

  function showInlineEditor(selection: SelectedElement): void {
    removeEditor();
    const form = doc.createElement("form");
    const position = editorPositionForSelection(selection);
    form.setAttribute(annotationUiAttribute, "true");
    form.style.position = "fixed";
    form.style.left = `${position.left}px`;
    form.style.top = `${position.top}px`;
    form.style.width = "300px";
    form.style.zIndex = "2147483647";
    form.style.background = "#0b1117";
    form.style.border = "1px solid #2dd4bf";
    form.style.borderRadius = "8px";
    form.style.boxShadow = "0 18px 44px rgba(0, 0, 0, 0.38)";
    form.style.color = "#e8edf2";
    form.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    form.style.padding = "12px";
    form.innerHTML = `
      <div style="font-size:12px;font-weight:800;color:#94a3b8;margin-bottom:6px;">Annotate element</div>
      <div style="font-size:13px;font-weight:800;line-height:1.3;margin-bottom:8px;overflow-wrap:anywhere;">${escapeHtml(
        selection.textExcerpt || selection.selector
      )}</div>
      <textarea name="note" placeholder="Describe the requested UI change." required rows="4" style="box-sizing:border-box;width:100%;background:#111a23;border:1px solid #334554;border-radius:6px;color:#e8edf2;font:13px ui-sans-serif,system-ui;padding:8px;resize:vertical;"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <select name="changeType" style="background:#111a23;border:1px solid #334554;border-radius:6px;color:#e8edf2;padding:7px;">
          <option value="layout">Layout</option>
          <option value="copy">Copy</option>
          <option value="color">Color</option>
          <option value="state">State</option>
          <option value="navigation">Navigation</option>
          <option value="platform-parity">Platform parity</option>
          <option value="other">Other</option>
        </select>
        <select name="priority" style="background:#111a23;border:1px solid #334554;border-radius:6px;color:#e8edf2;padding:7px;">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:9px;">
        <input name="ios" type="checkbox" /> iOS SwiftUI
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <button name="cancel" type="button" style="border:1px solid #334554;border-radius:6px;background:#172330;color:#e8edf2;font-weight:800;padding:8px;">Cancel</button>
        <button type="submit" style="border:0;border-radius:6px;background:#34d399;color:#07110d;font-weight:900;padding:8px;">Save</button>
      </div>
      <div data-status style="font-size:12px;line-height:1.35;margin-top:8px;color:#94a3b8;"></div>
    `;

    form.addEventListener("mousedown", (event) => event.stopPropagation());
    form.addEventListener("click", (event) => event.stopPropagation());
    form.querySelector<HTMLButtonElement>("[name='cancel']")?.addEventListener("click", () => {
      activeSelection = null;
      setMode("selecting");
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const status = form.querySelector<HTMLElement>("[data-status]");
      status!.textContent = "Saving...";
      sendRuntimeMessageSafely(
        {
          type: "ui-annotations.saveInlineAnnotation",
          selection,
          note: String(data.get("note") ?? ""),
          changeType: String(data.get("changeType") ?? "layout"),
          priority: String(data.get("priority") ?? "medium"),
          targetPlatforms: data.get("ios") ? ["web", "ios-swiftui"] : ["web"]
        },
        (response) => {
          const result = response as { ok?: boolean; error?: string; annotationId?: string } | undefined;
          if (result?.ok) {
            status!.style.color = "#86efac";
            status!.textContent = `Added ${result.annotationId ?? "annotation"} to pending list`;
            activeSelection = null;
            setTimeout(() => setMode("idle"), 450);
            return;
          }
          status!.style.color = "#fca5a5";
          status!.textContent = result?.error ?? "Could not save annotation.";
        }
      );
    });

    doc.documentElement.appendChild(form);
    editor = form;
    form.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }

  function completeSelectionFromEvent(event: MouseEvent): boolean {
    const target = swallowSelectionEvent(event);
    if (!target) {
      return false;
    }

    sendSelection(target);
    setMode("editing");
    if (activeSelection) {
      showInlineEditor(activeSelection);
    }
    return true;
  }

  function shouldHandleModeMessage(message: ModeMessage): boolean {
    if (!message.commandId) {
      return true;
    }

    if (handledCommandIds.has(message.commandId)) {
      return false;
    }

    handledCommandIds.add(message.commandId);
    return true;
  }

  function toggleMode(): void {
    setMode(mode === "idle" ? "selecting" : "idle");
  }

  doc.addEventListener(
    "mousedown",
    (event) => {
      if (blockEditingEvent(event)) {
        return;
      }

      completeSelectionFromEvent(event);
    },
    { capture: true }
  );

  doc.addEventListener(
    "pointerdown",
    (event) => {
      if (event instanceof MouseEvent) {
        if (blockEditingEvent(event)) {
          return;
        }
        completeSelectionFromEvent(event);
      }
    },
    { capture: true }
  );

  for (const eventName of ["mouseup", "click", "dblclick"]) {
    doc.addEventListener(
      eventName,
      (event) => {
        if (event instanceof MouseEvent) {
          if (blockEditingEvent(event)) {
            return;
          }
          if (eventName === "click") {
            completeSelectionFromEvent(event);
            return;
          }
          swallowSelectionEvent(event);
        }
      },
      { capture: true }
    );
  }

  chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (typeof message === "object" && message && "type" in message) {
      const modeMessage = message as ModeMessage;
      if (!shouldHandleModeMessage(modeMessage)) {
        return;
      }

      if (message.type === "ui-annotations.startSelecting") {
        setMode("selecting");
      }

      if (message.type === "ui-annotations.toggleSelecting") {
        toggleMode();
      }

      if (message.type === "ui-annotations.cancelSelecting") {
        setMode("idle");
      }
    }
  });

  doc.defaultView?.addEventListener("message", (event) => {
    const modeMessage = event.data as ModeMessage | undefined;
    if (!modeMessage || !shouldHandleModeMessage(modeMessage)) {
      return;
    }

    if (modeMessage.type === "ui-annotations.startSelecting") {
      setMode("selecting");
    }

    if (modeMessage.type === "ui-annotations.toggleSelecting") {
      toggleMode();
    }
  });

  installedOverlays.set(doc, overlay);
  return overlay;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return entities[character] ?? character;
  });
}

if (typeof document !== "undefined") {
  installAnnotationOverlay();
}
