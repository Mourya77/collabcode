import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { buildDocumentName, parseDocumentName, isUuid } from "../src/documentName.js";
import { authorizeDocument, verifyCollabToken, CollabAuthError, type CollabDb } from "../src/auth.js";
import { createPersistence, type PersistenceDb } from "../src/persistence.js";
import { loadEnv, KNOWN_DEV_JWT_SECRET } from "../src/config/env.js";
import { signTestToken, TEST_SECRET } from "./helpers.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const PROJECT2 = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

describe("documentName", () => {
  it("builds and parses the canonical form", () => {
    const name = buildDocumentName(PROJECT, FILE);
    expect(name).toBe(`project:${PROJECT}:file:${FILE}`);
    expect(parseDocumentName(name)).toEqual({ projectId: PROJECT, fileId: FILE });
  });
  it("rejects malformed names", () => {
    for (const bad of ["", "x", `project:${PROJECT}`, `file:${FILE}:project:${PROJECT}`, `project:not-a-uuid:file:${FILE}`, `project:${PROJECT}:file:${FILE}:extra`]) {
      expect(() => parseDocumentName(bad), bad).toThrow(/Invalid document name/);
    }
  });
  it("buildDocumentName refuses non-UUID ids", () => {
    expect(() => buildDocumentName("nope", FILE)).toThrow(/non-UUID/);
    expect(isUuid(PROJECT)).toBe(true);
    expect(isUuid("123")).toBe(false);
  });
});

describe("verifyCollabToken", () => {
  const claims = { userId: USER, projectId: PROJECT, role: "EDITOR" as const, name: "Ed Editor" };
  it("accepts a valid token and returns its claims", () => {
    expect(verifyCollabToken(signTestToken(claims), TEST_SECRET)).toEqual(claims);
  });
  it("rejects a missing token", () => {
    expect(() => verifyCollabToken(undefined, TEST_SECRET)).toThrowError(CollabAuthError);
    expect(() => verifyCollabToken("", TEST_SECRET)).toThrowError(/missing/);
  });
  it("rejects a tampered token", () => {
    const [h, p, s] = signTestToken(claims).split(".");
    const forged = jwt.sign(
      { projectId: PROJECT, role: "OWNER", name: "Forged" },
      "a-completely-different-secret-0123456789",
      { algorithm: "HS256", subject: USER, audience: "collab" },
    );
    expect(() => verifyCollabToken(forged, TEST_SECRET)).toThrowError(/invalid or expired/);
    expect(() => verifyCollabToken(`${h}.${p}.${s}x`, TEST_SECRET)).toThrowError(/invalid or expired/);
  });
  it("rejects an expired token", () => {
    const expired = signTestToken(claims, { expiresInSeconds: -10 });
    expect(() => verifyCollabToken(expired, TEST_SECRET)).toThrowError(/invalid or expired/);
  });
  it("rejects a token minted for a different audience (e.g. a REST access token)", () => {
    const accessLike = jwt.sign({}, "x".repeat(40), { algorithm: "HS256", subject: USER });
    const withSecret = jwt.sign(
      { projectId: PROJECT, role: "EDITOR", name: "Ed" },
      TEST_SECRET,
      { algorithm: "HS256", subject: USER, audience: "api" },
    );
    expect(() => verifyCollabToken(accessLike, TEST_SECRET)).toThrowError(CollabAuthError);
    expect(() => verifyCollabToken(withSecret, TEST_SECRET)).toThrowError(CollabAuthError);
  });
});

function fakeDb(overrides: {
  file?: { id: string; projectId: string; type: string } | null;
  member?: { role: "OWNER" | "EDITOR" | "VIEWER" } | null;
}): CollabDb {
  return {
    file: { findUnique: async () => overrides.file ?? null },
    projectMember: { findUnique: async () => overrides.member ?? null },
  };
}

describe("authorizeDocument (database checks — the document name is never trusted)", () => {
  const docName = buildDocumentName(PROJECT, FILE);
  const fileRow = { id: FILE, projectId: PROJECT, type: "FILE" };

  it("authorizes a member and returns the DATABASE role", async () => {
    // Token claims EDITOR, database says VIEWER — the database must win.
    const token = signTestToken({ userId: USER, projectId: PROJECT, role: "EDITOR", name: "Vi" });
    const identity = await authorizeDocument(fakeDb({ file: fileRow, member: { role: "VIEWER" } }), token, docName, TEST_SECRET);
    expect(identity).toMatchObject({ userId: USER, role: "VIEWER", readOnly: true, fileId: FILE, projectId: PROJECT });
  });
  it("marks EDITOR/OWNER as writable", async () => {
    const token = signTestToken({ userId: USER, projectId: PROJECT, role: "EDITOR", name: "Ed" });
    const identity = await authorizeDocument(fakeDb({ file: fileRow, member: { role: "EDITOR" } }), token, docName, TEST_SECRET);
    expect(identity.readOnly).toBe(false);
  });
  it("rejects a non-member even with a well-formed token for the project", async () => {
    const token = signTestToken({ userId: USER, projectId: PROJECT, role: "EDITOR", name: "Out" });
    await expect(authorizeDocument(fakeDb({ file: fileRow, member: null }), token, docName, TEST_SECRET)).rejects.toThrowError(/not a member/);
  });
  it("rejects when the file belongs to a different project than the name claims", async () => {
    const token = signTestToken({ userId: USER, projectId: PROJECT, role: "OWNER", name: "Ow" });
    const db = fakeDb({ file: { id: FILE, projectId: PROJECT2, type: "FILE" }, member: { role: "OWNER" } });
    await expect(authorizeDocument(db, token, docName, TEST_SECRET)).rejects.toThrowError(/does not exist in this project/);
  });
  it("rejects when the token was issued for a different project than the document", async () => {
    const token = signTestToken({ userId: USER, projectId: PROJECT2, role: "OWNER", name: "Ow" });
    await expect(authorizeDocument(fakeDb({ file: fileRow, member: { role: "OWNER" } }), token, docName, TEST_SECRET)).rejects.toThrowError(/different project/);
  });
  it("rejects folders as collaborative documents", async () => {
    const token = signTestToken({ userId: USER, projectId: PROJECT, role: "OWNER", name: "Ow" });
    const db = fakeDb({ file: { id: FILE, projectId: PROJECT, type: "FOLDER" }, member: { role: "OWNER" } });
    await expect(authorizeDocument(db, token, docName, TEST_SECRET)).rejects.toThrowError(/does not exist in this project/);
  });
});

describe("persistence (fake db)", () => {
  const docName = buildDocumentName(PROJECT, FILE);
  function makeFake() {
    const state = {
      yjs: null as { state: Uint8Array } | null,
      versions: [] as { fileId: string; createdBy: string; content: string; source: string }[],
      seedContent: "seeded from version",
      ownerId: USER,
    };
    const db: PersistenceDb = {
      yjsDocument: {
        findUnique: async () => state.yjs,
        upsert: async (args) => {
          state.yjs = { state: new Uint8Array(args.create.state) };
          return {};
        },
      },
      documentVersion: {
        findFirst: async () =>
          state.versions.length > 0
            ? { content: state.versions[state.versions.length - 1]!.content }
            : state.seedContent !== null
              ? { content: state.seedContent }
              : null,
        create: async (args) => {
          state.versions.push(args.data);
          return {};
        },
      },
      project: { findUnique: async () => ({ ownerId: state.ownerId }) },
    };
    return { state, db };
  }

  it("fetch returns persisted bytes or null", async () => {
    const { state, db } = makeFake();
    const p = createPersistence(db, { versionSyncMinIntervalMs: 0 });
    await expect(p.fetch({ documentName: docName })).resolves.toBeNull();
    state.yjs = { state: new Uint8Array([1, 2, 3]) };
    await expect(p.fetch({ documentName: docName })).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it("seedIfNeeded seeds once from the latest version and never when state exists", async () => {
    const { state, db } = makeFake();
    const p = createPersistence(db, { versionSyncMinIntervalMs: 0 });
    const doc = new Y.Doc();
    await expect(p.seedIfNeeded(doc, docName)).resolves.toBe(true);
    expect(doc.getText("content").toString()).toBe("seeded from version");
    state.yjs = { state: new Uint8Array([9]) };
    const doc2 = new Y.Doc();
    await expect(p.seedIfNeeded(doc2, docName)).resolves.toBe(false);
    expect(doc2.getText("content").toString()).toBe("");
    doc.destroy();
    doc2.destroy();
  });

  it("store upserts state and syncs a DocumentVersion only when text changed", async () => {
    const { state, db } = makeFake();
    state.seedContent = null as unknown as string; // no pre-existing version
    const p = createPersistence(db, { versionSyncMinIntervalMs: 0 });
    p.noteEditor(docName, USER);
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "hello");
    await p.store({ documentName: docName, state: Y.encodeStateAsUpdate(doc), document: doc });
    expect(state.yjs).not.toBeNull();
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0]).toMatchObject({ content: "hello", createdBy: USER, source: "AUTOSAVE" });
    await p.store({ documentName: docName, state: Y.encodeStateAsUpdate(doc), document: doc });
    expect(state.versions).toHaveLength(1); // unchanged text ⇒ no new version
    doc.destroy();
  });

  it("store retries a failing upsert with backoff and then succeeds (Phase 6)", async () => {
    const { state, db } = makeFake();
    state.seedContent = null as unknown as string;
    let failures = 2;
    const realUpsert = db.yjsDocument.upsert;
    db.yjsDocument.upsert = async (args) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("connection reset by peer");
      }
      return realUpsert(args);
    };
    const persisted: string[] = [];
    const p = createPersistence(db, {
      versionSyncMinIntervalMs: 0,
      storeMaxAttempts: 4,
      storeBaseDelayMs: 1,
      storeMaxDelayMs: 2,
      hooks: { onPersisted: (name) => persisted.push(name) },
    });
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "retried");
    await p.store({ documentName: docName, state: Y.encodeStateAsUpdate(doc), document: doc });
    expect(state.yjs).not.toBeNull();
    expect(p.pendingCount()).toBe(0);
    expect(persisted).toEqual([docName]);
    doc.destroy();
  });

  it("store parks as pending after the retry budget, notifies failure, and retryPending lands it later (Phase 6)", async () => {
    const { state, db } = makeFake();
    state.seedContent = null as unknown as string;
    let down = true;
    const realUpsert = db.yjsDocument.upsert;
    db.yjsDocument.upsert = async (args) => {
      if (down) throw new Error("database is down");
      return realUpsert(args);
    };
    const events: string[] = [];
    const p = createPersistence(db, {
      versionSyncMinIntervalMs: 0,
      storeMaxAttempts: 2,
      storeBaseDelayMs: 1,
      storeMaxDelayMs: 2,
      hooks: {
        onPersisted: () => events.push("persisted"),
        onPersistFailed: () => events.push("persist-failed"),
      },
    });
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "parked");
    await p.store({ documentName: docName, state: Y.encodeStateAsUpdate(doc), document: doc });
    expect(p.pendingCount()).toBe(1);
    expect(events).toEqual(["persist-failed"]);
    expect(state.yjs).toBeNull(); // nothing durable yet — and nothing claimed otherwise

    down = false; // database recovers; the sweeper path lands the freshest state
    doc.getText("content").insert(6, "+more");
    await expect(p.retryPending()).resolves.toBe(1);
    expect(p.pendingCount()).toBe(0);
    expect(events).toEqual(["persist-failed", "persisted"]);
    expect(state.yjs).not.toBeNull();
    doc.destroy();
  });

  it("fetch retries transient failures (Phase 6)", async () => {
    const { state, db } = makeFake();
    state.yjs = { state: new Uint8Array([7, 7]) };
    let failures = 1;
    const realFind = db.yjsDocument.findUnique;
    db.yjsDocument.findUnique = async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("connection terminated");
      }
      return realFind({ where: { fileId: FILE } });
    };
    const p = createPersistence(db, { versionSyncMinIntervalMs: 0, storeMaxAttempts: 3, storeBaseDelayMs: 1, storeMaxDelayMs: 2 });
    await expect(p.fetch({ documentName: docName })).resolves.toEqual(new Uint8Array([7, 7]));
  });

  it("store throttles version creation within the minimum interval", async () => {
    const { state, db } = makeFake();
    state.seedContent = null as unknown as string;
    const p = createPersistence(db, { versionSyncMinIntervalMs: 60_000 });
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "v1");
    await p.store({ documentName: docName, state: Y.encodeStateAsUpdate(doc), document: doc });
    doc.getText("content").insert(2, "+v2");
    await p.store({ documentName: docName, state: Y.encodeStateAsUpdate(doc), document: doc });
    expect(state.versions).toHaveLength(1); // second store inside the window ⇒ throttled
    doc.destroy();
  });
});

describe("production env guards (Phase 7)", () => {
  const prodBase = {
    NODE_ENV: "production",
    COLLAB_INTERNAL_TOKEN: "a-real-internal-token-0123456789",
  } as const;

  it("rejects the API's known dev JWT secret in production", () => {
    expect(() => loadEnv({ ...prodBase, JWT_SECRET: KNOWN_DEV_JWT_SECRET })).toThrow(/at least 32 characters/);
  });

  it("rejects a short JWT secret in production (< 32 chars)", () => {
    expect(() => loadEnv({ ...prodBase, JWT_SECRET: "only-20-chars-long-x" })).toThrow(/at least 32 characters/);
  });

  it("rejects a short COLLAB_JWT_SECRET in production even when JWT_SECRET is strong", () => {
    expect(
      () => loadEnv({ ...prodBase, JWT_SECRET: "s".repeat(40), COLLAB_JWT_SECRET: "short-secret-16c" }),
    ).toThrow(/at least 32 characters/);
  });

  it("accepts strong secrets in production", () => {
    const env = loadEnv({ ...prodBase, JWT_SECRET: "s".repeat(40) });
    expect(env.NODE_ENV).toBe("production");
    expect(env.ALLOWED_ORIGINS_LIST).toEqual(["http://localhost:5173"]);
  });

  it("parses a comma-separated ALLOWED_ORIGINS list", () => {
    const env = loadEnv({ ALLOWED_ORIGINS: "https://app.example.com, http://localhost:5173" });
    expect(env.ALLOWED_ORIGINS_LIST).toEqual(["https://app.example.com", "http://localhost:5173"]);
  });
});
