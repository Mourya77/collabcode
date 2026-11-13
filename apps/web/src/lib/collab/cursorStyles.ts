import { hexToRgba } from "./colors";
import type { LiveUser } from "./presence";

/**
 * CSS for remote cursors/selections rendered by y-monaco.
 *
 * y-monaco decorates remote ranges with classes `yRemoteSelection-<clientId>`
 * and caret elements with `yRemoteSelectionHead-<clientId>`. Colours and the
 * name flag are per-user, so the rules are generated from the live awareness
 * state and injected in a <style> element by the workspace. The local user's
 * own decorations are never rendered by y-monaco, and are skipped here too.
 */
export function buildRemoteSelectionCss(users: LiveUser[]): string {
  return users
    .filter((u) => !u.isSelf)
    .map((u) => {
      const selection = hexToRgba(u.color, 0.3);
      const name = u.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]/g, " ");
      return [
        `.yRemoteSelection-${u.clientId} { background-color: ${selection}; }`,
        `.yRemoteSelectionHead-${u.clientId} { border-color: ${u.color}; }`,
        `.yRemoteSelectionHead-${u.clientId}::after { content: "${name}"; background-color: ${u.color}; }`,
      ].join("\n");
    })
    .join("\n");
}
