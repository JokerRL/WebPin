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
  });
});
