# Engineering standards

## Naming
- Packages: `@collabcode/<name>`; apps are `web`, `api`, `collaboration`, `execution`.
- Files: `camelCase.ts` for modules, `PascalCase.tsx` for React components; types `PascalCase`; env vars `SCREAMING_SNAKE_CASE`.

## API response envelope
All `/api/v1` resource endpoints return:
```json
{ "success": true, "data": {}, "error": null, "requestId": "uuid" }
```
Errors: `{ "success": false, "data": null, "error": { "code": "STRING_CODE", "message": "..." }, "requestId": "uuid" }`.
Service-level error bodies from the shared `makeApiError` helper use `{ "error": { code, message, requestId } }` (health endpoints return the bare `HealthStatus`). Every response also sets the `x-request-id` header. Codes are stable strings (`NOT_FOUND`, `VALIDATION_ERROR`, `NOT_IMPLEMENTED`, `INTERNAL_ERROR`), never raw stack traces.

## Error handling
Validate at the boundary with Zod; throw/return typed errors; central Express error-handler middleware; never swallow errors silently; never expose stack traces or secrets to clients.

## Logging
Structured, one line per event, prefixed with requestId for HTTP services: `[<requestId>] <level> <message>`. No secrets, tokens, passwords, or user code in logs. `console` is acceptable in Phase 0; a structured logger (pino) is a Phase 6 hardening item.

## TypeScript
`strict` + `noUncheckedIndexedAccess` everywhere (from `@collabcode/config`); `exactOptionalPropertyTypes` is off because several libraries are incompatible with it.

## Formatting / lint
Shared Prettier + ESLint flat config from `@collabcode/config`, re-exported by every app/package.
