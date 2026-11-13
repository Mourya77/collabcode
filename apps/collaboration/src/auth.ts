import jwt from "jsonwebtoken";
import type { ProjectRole } from "@collabcode/shared";
import { parseDocumentName } from "./documentName.js";

/**
 * Collaboration authentication & document authorization (Phase 3).
 *
 * Clients present a short-lived collab JWT issued by the API
 * (POST /api/collab/token, audience "collab", signed with the shared
 * JWT_SECRET). Verification here is two-layered:
 *   1. cryptographic — signature, expiry and audience are checked;
 *   2. database — the document name is NEVER trusted: the file must exist,
 *      must belong to the project in the document name (and in the token),
 *      and the token's subject must hold a ProjectMember row for that
 *      project. The role used for read-only enforcement comes from the
 *      membership row (database truth), not from the token claim.
 */

export class CollabAuthError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.status = status;
    this.name = "CollabAuthError";
  }
}

export interface CollabTokenClaims {
  userId: string;
  projectId: string;
  role: ProjectRole;
  name: string;
}

/** Verifies signature/expiry/audience of a collab JWT. Throws CollabAuthError(401). */
export function verifyCollabToken(token: unknown, secret: string): CollabTokenClaims {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new CollabAuthError(401, "Unauthorized: missing authentication token");
  }
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ["HS256"], audience: "collab" }) as jwt.JwtPayload;
  } catch {
    throw new CollabAuthError(401, "Unauthorized: invalid or expired authentication token");
  }
  const role = (payload as { role?: unknown }).role;
  const name = (payload as { name?: unknown }).name;
  const projectId = (payload as { projectId?: unknown }).projectId;
  if (
    typeof payload.sub !== "string" ||
    typeof projectId !== "string" ||
    typeof name !== "string" ||
    (role !== "OWNER" && role !== "EDITOR" && role !== "VIEWER")
  ) {
    throw new CollabAuthError(401, "Unauthorized: malformed authentication token");
  }
  return { userId: payload.sub, projectId, role, name };
}

/** The slice of the database the authorizer needs (structurally typed for unit tests). */
export interface CollabDb {
  file: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; projectId: string; type: string } | null>;
  };
  projectMember: {
    findUnique(args: {
      where: { projectId_userId: { projectId: string; userId: string } };
    }): Promise<{ role: ProjectRole } | null>;
  };
}

export interface CollabIdentity {
  userId: string;
  name: string;
  projectId: string;
  fileId: string;
  /** Authoritative role from the ProjectMember row (not the token claim). */
  role: ProjectRole;
  /** VIEWERs connect read-only: the server refuses their document updates. */
  readOnly: boolean;
}

/**
 * Full per-document authorization: token + document name + database checks.
 * Throws CollabAuthError with a 401/403-style message on any failure; the
 * Hocuspocus onAuthenticate hook lets it propagate, which rejects the
 * connection before any document state is loaded or synced.
 */
export async function authorizeDocument(
  db: CollabDb,
  token: unknown,
  documentName: string,
  secret: string,
): Promise<CollabIdentity> {
  const claims = verifyCollabToken(token, secret);

  let parsed: { projectId: string; fileId: string };
  try {
    parsed = parseDocumentName(documentName);
  } catch {
    throw new CollabAuthError(403, "Forbidden: invalid document name");
  }

  if (claims.projectId !== parsed.projectId) {
    throw new CollabAuthError(403, "Forbidden: token was issued for a different project");
  }

  const file = await db.file.findUnique({ where: { id: parsed.fileId } });
  if (!file || file.projectId !== parsed.projectId || file.type !== "FILE") {
    throw new CollabAuthError(403, "Forbidden: document does not exist in this project");
  }

  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: parsed.projectId, userId: claims.userId } },
  });
  if (!member) {
    throw new CollabAuthError(403, "Forbidden: not a member of this project");
  }

  return {
    userId: claims.userId,
    name: claims.name,
    projectId: parsed.projectId,
    fileId: parsed.fileId,
    role: member.role,
    readOnly: member.role === "VIEWER",
  };
}
