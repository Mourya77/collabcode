import { describe, it, expect } from "vitest";
import { languageFromFilename } from "../src/lib/language";

describe("languageFromFilename", () => {
  it("detects TypeScript variants", () => {
    expect(languageFromFilename("main.ts")).toBe("typescript");
    expect(languageFromFilename("App.tsx")).toBe("typescript");
  });
  it("detects JavaScript", () => {
    expect(languageFromFilename("index.js")).toBe("javascript");
    expect(languageFromFilename("widget.jsx")).toBe("javascript");
  });
  it("detects Python", () => {
    expect(languageFromFilename("app.py")).toBe("python");
  });
  it("detects Java and C++", () => {
    expect(languageFromFilename("Main.java")).toBe("java");
    expect(languageFromFilename("main.cpp")).toBe("cpp");
    expect(languageFromFilename("header.h")).toBe("cpp");
  });
  it("detects JSON, HTML, CSS and Markdown", () => {
    expect(languageFromFilename("data.json")).toBe("json");
    expect(languageFromFilename("index.html")).toBe("html");
    expect(languageFromFilename("styles.css")).toBe("css");
    expect(languageFromFilename("README.md")).toBe("markdown");
  });
  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(languageFromFilename("notes.weirdext")).toBe("plaintext");
    expect(languageFromFilename("LICENSE")).toBe("plaintext");
    expect(languageFromFilename("src/deep/file.ts")).toBe("typescript");
  });
});
