import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";

// Boot guards live in config/env.ts: production rejects the dev internal
// token AND EXECUTION_RUNNER=subprocess. This process must run on an
// isolated, Docker-capable host — never beside the public API in production.
app.listen(env.PORT, () => {
  logger.info("listening", {
    port: env.PORT,
    runner: env.EXECUTION_RUNNER,
    timeoutMs: env.EXECUTION_TIMEOUT_MS,
    memoryMb: env.EXECUTION_MEMORY_MB,
  });
});
