/**
 * Structured logging for @collabcode/execution (Phase 7 alignment).
 *
 * Emits one JSON object per line — the same shape the API (pino) and the
 * collaboration server produce — tagged with the service name so log
 * pipelines can split streams. Job events carry the executionId so a run
 * can be traced across the API and this service.
 */
type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, service: "execution", event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};
