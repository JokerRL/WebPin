import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

type ChromeStub = {
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: (listener: (message: unknown) => void) => void;
    };
  };
};

function makeChromeStub() {
  const listeners: Array<(message: unknown) => void> = [];
  const chromeStub: ChromeStub = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: (listener) => {
          listeners.push(listener);
        }
      }
    }
  };

  return {
    chromeStub,
    sendRuntimeMessage: (message: unknown) => {
      for (const listener of listeners) {
        listener(message);
      }
    }
  };
}

function installDom(html: string) {
  const dom = new JSDOM(html, { url: "file:///Users/joker/Desktop/familyLocator/prototype/app.html#welcome" });
  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousMouseEvent = globalThis.MouseEvent;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;

  return {
    dom,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.MouseEvent = previousMouseEvent;
      globalThis.window = previousWindow;
    }
  };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("installAnnotationOverlay", () => {
  it("installs a passive overlay that follows hovered elements", async () => {
    const { dom, restore } = installDom("<!doctype html><html><body><button id=\"target\">Save</button></body></html>");

    try {
      const { chromeStub, sendRuntimeMessage } = makeChromeStub();
      vi.stubGlobal("chrome", chromeStub);
      const { installAnnotationOverlay } = await import("./content");
      const overlay = installAnnotationOverlay(dom.window.document);
      const target = dom.window.document.getElementById("target");
      if (!target) {
        throw new Error("Missing target");
      }

      target.getBoundingClientRect = () =>
        ({
          x: 10,
          y: 20,
          left: 10,
          top: 20,
          right: 110,
          bottom: 60,
          width: 100,
          height: 40,
          toJSON: () => ({})
        }) as DOMRect;

      expect(overlay.style.display).toBe("none");
      sendRuntimeMessage({ type: "ui-annotations.startSelecting" });
      target.dispatchEvent(new dom.window.MouseEvent("mousemove", { bubbles: true }));

      expect(overlay.style.pointerEvents).toBe("none");
      expect(overlay.style.display).toBe("block");
      expect(overlay.style.left).toBe("10px");
      expect(overlay.style.top).toBe("20px");
      expect(overlay.style.width).toBe("100px");
      expect(overlay.style.height).toBe("40px");
    } finally {
      restore();
    }
  });

  it("sends selected element metadata when an element is option-clicked", async () => {
    const { dom, restore } = installDom(
      "<!doctype html><html><body><main><button id=\"continue\" data-testid=\"cta\">继续</button></main></body></html>"
    );
    const { chromeStub, sendRuntimeMessage } = makeChromeStub();
    vi.stubGlobal("chrome", chromeStub);

    try {
      const { installAnnotationOverlay } = await import("./content");
      const target = dom.window.document.getElementById("continue");
      if (!target) {
        throw new Error("Missing target");
      }
      target.getBoundingClientRect = () =>
        ({
          x: 24,
          y: 48,
          left: 24,
          top: 48,
          right: 224,
          bottom: 96,
          width: 200,
          height: 48,
          toJSON: () => ({})
        }) as DOMRect;

      installAnnotationOverlay(dom.window.document);
      sendRuntimeMessage({ type: "ui-annotations.startSelecting" });
      target.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));

      expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
        type: "ui-annotations.elementSelected",
        selection: expect.objectContaining({
          url: "file:///Users/joker/Desktop/familyLocator/prototype/app.html#welcome",
          route: "#welcome",
          selector: "[data-testid=\"cta\"]",
          textExcerpt: "继续",
          boundingBox: { x: 24, y: 48, width: 200, height: 48 },
          viewport: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) })
        })
      }, expect.any(Function));
    } finally {
      restore();
    }
  });

  it("captures selection-mode pointerdown before prototype handlers can run", async () => {
    const { dom, restore } = installDom("<!doctype html><html><body><button id=\"back\">返回</button></body></html>");
    const { chromeStub, sendRuntimeMessage } = makeChromeStub();
    vi.stubGlobal("chrome", chromeStub);
    const prototypeHandler = vi.fn();

    try {
      const { installAnnotationOverlay } = await import("./content");
      const target = dom.window.document.getElementById("back");
      if (!target) {
        throw new Error("Missing target");
      }
      target.getBoundingClientRect = () =>
        ({
          x: 8,
          y: 16,
          left: 8,
          top: 16,
          right: 88,
          bottom: 56,
          width: 80,
          height: 40,
          toJSON: () => ({})
        }) as DOMRect;

      installAnnotationOverlay(dom.window.document);
      target.addEventListener("mousedown", prototypeHandler);
      sendRuntimeMessage({ type: "ui-annotations.startSelecting" });
      target.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));

      expect(prototypeHandler).not.toHaveBeenCalled();
      expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
        type: "ui-annotations.elementSelected",
        selection: expect.objectContaining({
          selector: "#back",
          textExcerpt: "返回",
          boundingBox: { x: 8, y: 16, width: 80, height: 40 }
        })
      }, expect.any(Function));
    } finally {
      restore();
    }
  });

  it("opens the inline editor when selection completes from a click fallback", async () => {
    const { dom, restore } = installDom("<!doctype html><html><body><button id=\"allow\">允许并继续</button></body></html>");
    const { chromeStub, sendRuntimeMessage } = makeChromeStub();
    vi.stubGlobal("chrome", chromeStub);

    try {
      const { installAnnotationOverlay } = await import("./content");
      const target = dom.window.document.getElementById("allow");
      if (!target) {
        throw new Error("Missing target");
      }
      target.getBoundingClientRect = () =>
        ({
          x: 600,
          y: 900,
          left: 600,
          top: 900,
          right: 1156,
          bottom: 980,
          width: 556,
          height: 80,
          toJSON: () => ({})
        }) as DOMRect;

      installAnnotationOverlay(dom.window.document);
      sendRuntimeMessage({ type: "ui-annotations.startSelecting" });
      target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));

      expect(dom.window.document.querySelector("[data-ui-annotations-root]")).toBeTruthy();
      expect(dom.window.document.querySelector("[data-ui-annotations-root] textarea")).toBeTruthy();
      expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui-annotations.elementSelected" }),
        expect.any(Function)
      );
    } finally {
      restore();
    }
  });

  it("keeps the inline editor usable when runtime messaging is unavailable", async () => {
    const { dom, restore } = installDom("<!doctype html><html><body><button id=\"allow\">允许并继续</button></body></html>");
    const { chromeStub, sendRuntimeMessage } = makeChromeStub();
    chromeStub.runtime.sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    vi.stubGlobal("chrome", chromeStub);

    try {
      const { installAnnotationOverlay } = await import("./content");
      const target = dom.window.document.getElementById("allow");
      if (!target) {
        throw new Error("Missing target");
      }
      target.getBoundingClientRect = () =>
        ({
          x: 600,
          y: 900,
          left: 600,
          top: 900,
          right: 1156,
          bottom: 980,
          width: 556,
          height: 80,
          toJSON: () => ({})
        }) as DOMRect;

      installAnnotationOverlay(dom.window.document);
      sendRuntimeMessage({ type: "ui-annotations.startSelecting" });

      expect(() => {
        target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
      }).not.toThrow();
      expect(dom.window.document.querySelector("[data-ui-annotations-root] textarea")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("does not show the overlay or intercept clicks outside selection mode", async () => {
    const { dom, restore } = installDom("<!doctype html><html><body><button id=\"target\">完成</button></body></html>");
    const { chromeStub } = makeChromeStub();
    vi.stubGlobal("chrome", chromeStub);
    const prototypeHandler = vi.fn();

    try {
      const { installAnnotationOverlay } = await import("./content");
      const overlay = installAnnotationOverlay(dom.window.document);
      const target = dom.window.document.getElementById("target");
      if (!target) {
        throw new Error("Missing target");
      }

      target.addEventListener("mousedown", prototypeHandler);
      target.dispatchEvent(new dom.window.MouseEvent("mousemove", { bubbles: true }));
      target.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));

      expect(overlay.style.display).toBe("none");
      expect(prototypeHandler).toHaveBeenCalledTimes(1);
      expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("toggles between browsing and selection mode from the shortcut command", async () => {
    const { dom, restore } = installDom("<!doctype html><html><body><button id=\"target\">完成</button></body></html>");
    const { chromeStub, sendRuntimeMessage } = makeChromeStub();
    vi.stubGlobal("chrome", chromeStub);
    const prototypeHandler = vi.fn();

    try {
      const { installAnnotationOverlay } = await import("./content");
      const overlay = installAnnotationOverlay(dom.window.document);
      const target = dom.window.document.getElementById("target");
      if (!target) {
        throw new Error("Missing target");
      }
      target.getBoundingClientRect = () =>
        ({
          x: 12,
          y: 18,
          left: 12,
          top: 18,
          right: 112,
          bottom: 58,
          width: 100,
          height: 40,
          toJSON: () => ({})
        }) as DOMRect;
      target.addEventListener("mousedown", prototypeHandler);

      sendRuntimeMessage({ type: "ui-annotations.toggleSelecting" });
      target.dispatchEvent(new dom.window.MouseEvent("mousemove", { bubbles: true }));
      expect(overlay.style.display).toBe("block");
      expect(dom.window.document.querySelector("[data-ui-annotations-toast]")?.textContent).toContain("Annotation mode on");
      expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
        type: "ui-annotations.modeChanged",
        mode: "selecting"
      }, expect.any(Function));

      sendRuntimeMessage({ type: "ui-annotations.toggleSelecting" });
      target.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));

      expect(overlay.style.display).toBe("none");
      expect(dom.window.document.querySelector("[data-ui-annotations-toast]")?.textContent).toContain("Annotation mode off");
      expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
        type: "ui-annotations.modeChanged",
        mode: "idle"
      }, expect.any(Function));
      expect(prototypeHandler).toHaveBeenCalledTimes(1);
      expect(chromeStub.runtime.sendMessage.mock.calls.map(([message]) => message)).not.toContainEqual(
        expect.objectContaining({ type: "ui-annotations.elementSelected" })
      );
    } finally {
      restore();
    }
  });

  it("ignores duplicate shortcut commands that arrive through frame forwarding", async () => {
    const { dom, restore } = installDom("<!doctype html><html><body><button id=\"target\">完成</button></body></html>");
    const { chromeStub, sendRuntimeMessage } = makeChromeStub();
    vi.stubGlobal("chrome", chromeStub);
    const prototypeHandler = vi.fn();

    try {
      const { installAnnotationOverlay } = await import("./content");
      const overlay = installAnnotationOverlay(dom.window.document);
      const target = dom.window.document.getElementById("target");
      if (!target) {
        throw new Error("Missing target");
      }
      target.getBoundingClientRect = () =>
        ({
          x: 12,
          y: 18,
          left: 12,
          top: 18,
          right: 112,
          bottom: 58,
          width: 100,
          height: 40,
          toJSON: () => ({})
        }) as DOMRect;
      target.addEventListener("mousedown", prototypeHandler);

      sendRuntimeMessage({ type: "ui-annotations.toggleSelecting", commandId: "shortcut-1" });
      sendRuntimeMessage({ type: "ui-annotations.toggleSelecting", commandId: "shortcut-1" });
      target.dispatchEvent(new dom.window.MouseEvent("mousemove", { bubbles: true }));
      expect(overlay.style.display).toBe("block");
      target.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));

      expect(prototypeHandler).not.toHaveBeenCalled();
      expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui-annotations.elementSelected" }),
        expect.any(Function)
      );
    } finally {
      restore();
    }
  });
});
