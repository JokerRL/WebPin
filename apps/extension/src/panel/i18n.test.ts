import { describe, expect, it } from "vitest";
import { getPanelLanguage, panelText } from "./i18n";

describe("panel i18n", () => {
  it("uses Chinese for Chinese browser language tags", () => {
    expect(getPanelLanguage(["zh-CN", "en-US"])).toBe("zh");
    expect(getPanelLanguage(["zh-Hant-TW"])).toBe("zh");
  });

  it("falls back to English for non-Chinese or missing browser languages", () => {
    expect(getPanelLanguage(["fr-FR", "en-US"])).toBe("en");
    expect(getPanelLanguage([])).toBe("en");
  });

  it("provides English and Chinese side panel copy", () => {
    expect(panelText.en.title).toBe("UI Annotations");
    expect(panelText.zh.title).toBe("UI 标注");
    expect(panelText.en.accessKey).toBe("Access key");
    expect(panelText.en.accessKeyPlaceholder).toBe("Paste the key printed by the bridge");
    expect(panelText.en.connectBridge).toBe("Connect");
    expect(panelText.en.connectionStatuses).toEqual({
      offline: "Bridge offline",
      "key-required": "Key required",
      ready: "Ready"
    });
    expect(panelText.zh.accessKey).toBe("访问密钥");
    expect(panelText.zh.accessKeyPlaceholder).toBe("粘贴 bridge 启动时显示的密钥");
    expect(panelText.zh.connectBridge).toBe("连接");
    expect(panelText.zh.connectionStatuses).toEqual({
      offline: "Bridge 离线",
      "key-required": "需要密钥",
      ready: "已就绪"
    });
    expect(panelText.en.messages.accessKeyRejected).toBe("Access key rejected.");
    expect(panelText.en.messages.bridgeReady("WebPin")).toContain("WebPin");
    expect(panelText.zh.messages.accessKeyRejected).toBe("访问密钥被拒绝。");
    expect(panelText.zh.messages.bridgeReady("WebPin")).toContain("WebPin");
    expect(panelText.en.messages.pendingProjectMismatch).toContain("current project");
    expect(panelText.zh.messages.pendingProjectMismatch).toContain("当前项目");
  });
});
