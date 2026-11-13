import { pino } from "pino";
import { env } from "../config/env.js";

/**
 * Structured logging (pino). Authorization and cookie headers are redacted so
 * credentials never reach the logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "headers.authorization", "headers.cookie"],
    censor: "[redacted]",
  },
});
