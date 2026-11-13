export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "USER_NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE_INVITATION"
  | "INVITATION_EXPIRED"
  | "INVITATION_EMAIL_MISMATCH"
  | "UNSUPPORTED_LANGUAGE"
  | "COLLAB_UNAVAILABLE"
  | "TOO_MANY_RUNNING"
  | "EXECUTION_NOT_RUNNING"
  | "EXECUTION_DISABLED"
  | "RATE_LIMITED"
  | "INTERNAL";

/** Typed application error. The central error handler renders it into the API envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "VALIDATION_ERROR", message, details);
export const unauthorized = (message = "Authentication required.") => new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have permission to do that.") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found.") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);
export const collabUnavailable = (message: string) => new ApiError(502, "COLLAB_UNAVAILABLE", message);

/** Raised by repositories when a unique constraint would be violated. */
export class UniqueViolationError extends Error {
  readonly field: string;
  constructor(field: string, message?: string) {
    super(message ?? `Unique constraint violated: ${field}`);
    this.field = field;
  }
}
