import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../src/stores/editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
    useEditorStore.setState({ contents: {}, openTabs: [], activeFileId: null, dirtyFileIds: [], saveStatus: "saved" });
  });

  it("opens, activates and closes tabs", () => {
    const s = useEditorStore.getState();
    s.openFile("a");
    s.openFile("b");
    expect(useEditorStore.getState().openTabs).toEqual(["a", "b"]);
    expect(useEditorStore.getState().activeFileId).toBe("b");
    s.openFile("a"); // reopening does not duplicate
    expect(useEditorStore.getState().openTabs).toEqual(["a", "b"]);
    expect(useEditorStore.getState().activeFileId).toBe("a");
    s.closeFile("a");
    expect(useEditorStore.getState().openTabs).toEqual(["b"]);
    expect(useEditorStore.getState().activeFileId).toBe("b");
  });

  it("marks a file dirty when its content changes and clears on save", () => {
    const s = useEditorStore.getState();
    s.loadProject("p1", { a: "hello" }, "a");
    s.setContent("a", "hello world");
    expect(useEditorStore.getState().dirtyFileIds).toContain("a");
    expect(useEditorStore.getState().saveStatus).toBe("unsaved");
    s.markSaved();
    expect(useEditorStore.getState().dirtyFileIds).toEqual([]);
    expect(useEditorStore.getState().saveStatus).toBe("saved");
  });

  it("does not mark dirty when content is unchanged", () => {
    const s = useEditorStore.getState();
    s.loadProject("p1", { a: "hello" }, "a");
    s.setContent("a", "hello");
    expect(useEditorStore.getState().saveStatus).toBe("saved");
    expect(useEditorStore.getState().dirtyFileIds).toEqual([]);
  });
});
