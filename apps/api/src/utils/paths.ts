/**
 * File/folder name + path validation. Names are single path segments: anything
 * containing separators, dot-segments or control characters is rejected, which
 * makes path traversal ("../", "a/b", "a\b") impossible by construction.
 */
export function validateFileName(name: unknown): string | null {
  if (typeof name !== "string") return "Name must be a string.";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name must not be empty.";
  if (trimmed.length > 255) return "Name must be at most 255 characters.";
  if (trimmed !== name) return "Name must not have leading or trailing whitespace.";
  if (name === "." || name === "..") return "Name must not be a dot segment.";
  if (name.includes("/") || name.includes("\\")) return "Name must not contain path separators.";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return "Name must not contain control characters.";
  return null;
}

/** Joins a validated name onto a parent path ("" for project root). */
export function joinPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

/** True when `path` is strictly inside the folder at `folderPath`. */
export function isDescendantPath(path: string, folderPath: string): boolean {
  return path.startsWith(`${folderPath}/`);
}
