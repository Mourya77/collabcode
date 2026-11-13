import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { SUPPORTED_LANGUAGES, languageFromFilename } from "../lib/language";
import { useEditorStore } from "../stores/editorStore";
import { useUiStore } from "../stores/uiStore";
import type { CollabSession } from "../lib/collab/provider";
import type { FileNode } from "../types";

type MonacoEditor = Parameters<OnMount>[0];

/**
 * Monaco editor for one file.
 *
 * Phase 3: when a collaboration session is active, the editor's content
 * source is the session's Y.Text — a MonacoBinding (y-monaco) syncs the
 * model with the CRDT document and renders remote cursors/selections from
 * awareness state. There is deliberately no REST save in this mode: the
 * collaboration server persists Yjs updates and syncs DocumentVersions.
 *
 * Without a session (session still starting, or unit tests), it falls back
 * to the Phase 2 controlled mode driven by editorStore contents.
 */
export function CodeEditor({
  file,
  readOnly = false,
  session = null,
}: {
  file: FileNode;
  readOnly?: boolean;
  session?: CollabSession | null;
}) {
  const theme = useUiStore((s) => s.theme);
  const content = useEditorStore((s) => s.contents[file.id] ?? "");
  const setContent = useEditorStore((s) => s.setContent);
  const [language, setLanguage] = useState(() => languageFromFilename(file.name));
  const editorRef = useRef<MonacoEditor | null>(null);
  const [editorInstance, setEditorInstance] = useState<MonacoEditor | null>(null);

  const collabActive = session !== null && session.fileId === file.id;

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    setEditorInstance(editor);
  };

  // Bind the editor to the session's Y.Text once both exist (the session is
  // created by the workspace slightly after the editor mounts). The effect
  // cleanup destroys the binding and the mirror observer, so switching
  // files or unmounting never leaks listeners or syncs the wrong document.
  useEffect(() => {
    if (!editorInstance || !session || session.fileId !== file.id) return;
    const editor = editorInstance;
    const yText = session.yText;

    // Mirror the CRDT text into editorStore so the Problems panel and other
    // read-only consumers keep working off the same content.
    const mirror = () => {
      const text = yText.toString();
      const store = useEditorStore.getState();
      if (store.contents[file.id] !== text) store.setContentLoaded(file.id, text);
    };
    mirror();
    yText.observe(mirror);

    let disposed = false;
    let binding: { destroy(): void } | null = null;
    void (async () => {
      // y-monaco pulls in Monaco-adjacent code; load it only when a real
      // collaborative editor actually mounts.
      const { MonacoBinding } = await import("y-monaco");
      if (disposed) return;
      const model = editor.getModel();
      if (!model) return;
      binding = new MonacoBinding(yText, model, new Set([editor]), session.awareness);
    })();

    return () => {
      disposed = true;
      yText.unobserve(mirror);
      binding?.destroy();
      binding = null;
    };
  }, [editorInstance, session, file.id]);

  function handleFormat() {
    void editorRef.current?.getAction("editor.action.formatDocument")?.run();
  }

  return (
    <div className="flex h-full flex-col" data-testid="code-editor">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Language
          <select
            aria-label="Editor language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleFormat}
          className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Format
        </button>
        <span className="ml-auto truncate text-xs text-zinc-400">{file.name}</span>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          path={file.id}
          language={language}
          theme={theme === "dark" ? "vs-dark" : "light"}
          {...(collabActive
            ? {}
            : {
                value: content,
                onChange: (value: string | undefined) => {
                  if (!readOnly) setContent(file.id, value ?? "");
                },
              })}
          onMount={handleMount}
          options={{
            readOnly,
            minimap: { enabled: true },
            fontSize: 13,
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
