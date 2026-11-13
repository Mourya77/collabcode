/**
 * Job payload validation rules that Zod alone cannot express (path safety,
 * aggregate sizes). File paths come from the public API (which derives them
 * from the project's File rows) but are re-validated here — the execution
 * service never trusts its caller with filesystem paths.
 */

export const MAX_FILES = 50;
export const MAX_TOTAL_BYTES = 1_048_576; // 1 MiB

/**
 * True for a safe workspace-relative path: forward slashes, no leading slash,
 * no backslashes, no empty / "." / ".." segments, no control characters.
 * This makes directory traversal outside the job workspace impossible by
 * construction.
 */
export function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  const segments = p.split("/");
  return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
}

/** Human-readable reason a path is unsafe, or null when it is safe. */
export function pathProblem(p: unknown): string | null {
  if (typeof p !== "string" || p.length === 0) return "Path must be a non-empty string.";
  if (!isSafeRelativePath(p)) return `Path "${p}" is not a safe workspace-relative path.`;
  return null;
}
