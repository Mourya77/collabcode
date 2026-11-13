/**
 * Stable per-user collaboration colours. The colour is derived from the
 * user id with an FNV-1a hash, so every client independently assigns the
 * same colour to the same user within a workspace — no coordination needed.
 */
export const COLLAB_PALETTE = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
] as const;

export interface UserColor {
  /** Solid colour (cursors, avatar dots, name flags). */
  color: string;
  /** Same colour at low alpha (selection backgrounds), as #RRGGBBAA. */
  colorLight: string;
}

export function colorIndexForUser(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % COLLAB_PALETTE.length;
}

export function userColor(userId: string): UserColor {
  const color = COLLAB_PALETTE[colorIndexForUser(userId)] as string;
  return { color, colorLight: `${color}33` };
}

/** "#rrggbb" + alpha (0..1) → "rgba(r, g, b, a)" for CSS. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] as string, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
