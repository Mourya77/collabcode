import { useCallback, useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Camera, Eye, History, RotateCcw, X } from "lucide-react";
import { filesApi } from "../lib/api/files";
import { ApiClientError } from "../lib/api/client";
import type { ApiVersionMeta, ApiVersionSource } from "../lib/api/types";
import { languageFromFilename } from "../lib/language";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Version history (Phase 6): list, diff and restore for the active file.
 *
 * - The list comes from GET /api/files/:fileId/versions (metadata only —
 *   author, timestamp, source badge, label, size; content is fetched per
 *   version only when a diff is opened).
 * - Diff uses Monaco's DiffEditor: original = the selected version,
 *   modified = the current live editor content.
 * - Restore NEVER edits the document locally: it sends the current live
 *   content to the API, which snapshots it ("Before restore") and applies
 *   the restored content through the collaboration server, so every
 *   connected editor converges via normal sync.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
  fileName: string;
  /** EDITOR+ may snapshot and restore; VIEWERs get a read-only history. */
  canEdit: boolean;
  /** Reads the CURRENT live (Yjs) editor content at call time. */
  getCurrentContent: () => string;
}

const SOURCE_BADGES: Record<ApiVersionSource, { label: string; className: string }> = {
  SAVE: { label: "Save", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  SNAPSHOT: { label: "Snapshot", className: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  RESTORE: { label: "Restore point", className: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  AUTOSAVE: { label: "Autosave", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
};

export function sourceBadgeLabel(source: ApiVersionSource): string {
  return SOURCE_BADGES[source].label;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

export function VersionHistoryPanel({ open, onOpenChange, fileId, fileName, canEdit, getCurrentContent }: Props) {
  const [versions, setVersions] = useState<ApiVersionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [diff, setDiff] = useState<{ version: ApiVersionMeta; content: string; currentContent: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<ApiVersionMeta | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions(await filesApi.listVersions(fileId));
    } catch (e) {
      setError(messageOf(e, "Could not load version history."));
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (open) {
      setNotice(null);
      setDiff(null);
      setConfirmRestore(null);
      void load();
    }
  }, [open, load]);

  if (!open) return null;

  async function createSnapshot() {
    setBusy("snapshot");
    setError(null);
    try {
      const label = snapshotLabel.trim();
      await filesApi.saveVersion(fileId, getCurrentContent(), label || undefined);
      setSnapshotLabel("");
      setNotice(label ? `Snapshot “${label}” created.` : "Snapshot created.");
      await load();
    } catch (e) {
      setError(messageOf(e, "Could not create the snapshot."));
    } finally {
      setBusy(null);
    }
  }

  async function openDiff(version: ApiVersionMeta) {
    setBusy(version.id);
    setError(null);
    try {
      const full = await filesApi.getVersion(fileId, version.id);
      setDiff({ version, content: full.content, currentContent: getCurrentContent() });
    } catch (e) {
      setError(messageOf(e, "Could not load that version."));
    } finally {
      setBusy(null);
    }
  }

  async function doRestore(version: ApiVersionMeta) {
    setBusy(version.id);
    setError(null);
    try {
      await filesApi.restoreVersion(fileId, version.id, getCurrentContent());
      setConfirmRestore(null);
      setNotice("Restored — a snapshot of the previous content was saved.");
      await load();
    } catch (e) {
      setError(messageOf(e, "Restore failed."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Version history for ${fileName}`}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-5 dark:border-zinc-800">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              <History className="h-4 w-4" aria-hidden /> Version history
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {fileName} — restoring replaces the document for everyone, live. Your current content is snapshotted first.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close version history"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && (
            <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>
          )}
          {notice && (
            <p role="status" className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">{notice}</p>
          )}

          {canEdit && (
            <div className="mb-4 flex items-center gap-2">
              <Input
                aria-label="Snapshot label (optional)"
                placeholder="Snapshot label (optional)"
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                className="max-w-xs"
              />
              <Button type="button" size="sm" disabled={busy !== null} onClick={() => void createSnapshot()}>
                <Camera className="h-4 w-4" aria-hidden /> Create snapshot
              </Button>
            </div>
          )}

          {confirmRestore && (
            <div role="alertdialog" aria-label="Confirm restore" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 dark:border-amber-900 dark:bg-amber-950/50">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Restore the version from {formatAbsoluteTime(confirmRestore.createdAt)} by {confirmRestore.author.name}? The current
                document content will first be saved as a snapshot labelled “Before restore”, then the restored content will replace
                the document <strong>for all collaborators, live</strong>.
              </p>
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant="danger" disabled={busy !== null} onClick={() => void doRestore(confirmRestore)}>
                  Restore this version
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setConfirmRestore(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">Loading versions…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No versions yet. Versions appear when the document is saved, snapshotted, or autosaved from the live editor.</p>
          ) : (
            <ul className="space-y-1" aria-label="Versions">
              {versions.map((v) => {
                const badge = SOURCE_BADGES[v.source] ?? SOURCE_BADGES.SAVE;
                return (
                  <li key={v.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100" title={formatAbsoluteTime(v.createdAt)}>
                          {formatRelativeTime(v.createdAt)}
                        </span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", badge.className)}>{badge.label}</span>
                        {v.label && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">“{v.label}”</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {v.author.name} · {formatAbsoluteTime(v.createdAt)} · {v.sizeBytes} chars
                      </p>
                    </div>
                    <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void openDiff(v)} aria-label={`Preview diff for version from ${formatAbsoluteTime(v.createdAt)}`}>
                      <Eye className="h-4 w-4" aria-hidden /> Diff
                    </Button>
                    {canEdit && (
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setConfirmRestore(v)} aria-label={`Restore version from ${formatAbsoluteTime(v.createdAt)}`}>
                        <RotateCcw className="h-4 w-4" aria-hidden /> Restore
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {diff && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={() => setDiff(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Diff for version from ${formatAbsoluteTime(diff.version.createdAt)}`}
            className="flex h-[85vh] w-full max-w-5xl flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Version from {formatAbsoluteTime(diff.version.createdAt)} · {diff.version.author.name}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Left: that version. Right: current document content.</p>
              </div>
              <button
                type="button"
                aria-label="Close diff"
                onClick={() => setDiff(null)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1" data-testid="version-diff-editor">
              <DiffEditor
                original={diff.content}
                modified={diff.currentContent}
                language={languageFromFilename(fileName)}
                theme="vs-dark"
                options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false } }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
