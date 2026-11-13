import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  acceptInvite,
  appendToEditor,
  createProject,
  editorText,
  expectEditorToContain,
  inviteByEmail,
  openFile,
  registerUser,
  serveMonacoFromLocalPackage,
  typeInEditor,
  uniqueEmail,
} from "./helpers";

/**
 * Phase 7 E2E scenarios A–G against the REAL stack (no mocks):
 * built API + collaboration + execution services, production web build,
 * Monaco from its CDN, a dedicated embedded PostgreSQL.
 *
 * The scenarios are stateful and run serially in one project:
 *   owner registers → creates a project → invites an editor → both edit
 *   the same file live → Python execution → version snapshot/restore →
 *   a VIEWER's restrictions are verified.
 */

test.describe.serial("CollabCode E2E scenarios A–G", () => {
  let ownerCtx: BrowserContext;
  let editorCtx: BrowserContext;
  let viewerCtx: BrowserContext;
  let owner: Page;
  let editor: Page;
  let viewer: Page;

  const ownerEmail = uniqueEmail("owner");
  const editorEmail = uniqueEmail("editor");
  const viewerEmail = uniqueEmail("viewer");
  const projectName = `E2E Project ${Date.now().toString(36)}`;

  test.beforeAll(async ({ browser }) => {
    ownerCtx = await browser.newContext();
    editorCtx = await browser.newContext();
    viewerCtx = await browser.newContext();
    await serveMonacoFromLocalPackage(ownerCtx);
    await serveMonacoFromLocalPackage(editorCtx);
    await serveMonacoFromLocalPackage(viewerCtx);
    owner = await ownerCtx.newPage();
    editor = await editorCtx.newPage();
    viewer = await viewerCtx.newPage();
  });

  test.afterAll(async () => {
    await ownerCtx?.close();
    await editorCtx?.close();
    await viewerCtx?.close();
  });

  test("A: user registers, logs in and creates a project", async () => {
    await registerUser(owner, { name: "E2E Owner", email: ownerEmail });
    await expect(owner.getByText(/Welcome back, E2E/)).toBeVisible();
    await createProject(owner, projectName);
    // The workspace opens with the seeded welcome file in a live editor.
    await expect(owner.locator(".monaco-editor")).toBeVisible();
    await expectEditorToContain(owner, "Welcome to CollabCode");
  });

  test("B: owner invites a second collaborator, who accepts and appears as a member", async () => {
    const inviteUrl = await inviteByEmail(owner, editorEmail, "EDITOR");
    await owner.keyboard.press("Escape");
    // The invitee registers with the invited email, then accepts.
    await registerUser(editor, { name: "E2E Editor", email: editorEmail });
    await acceptInvite(editor, inviteUrl);
    await expect(editor.locator(".monaco-editor")).toBeVisible();
    // Owner sees the new member in the Members modal.
    await owner.getByRole("button", { name: /Members/ }).click();
    await expect(owner.getByText("E2E Editor").first()).toBeVisible();
    await expect(owner.getByText(editorEmail).first()).toBeVisible();
    await owner.keyboard.press("Escape");
  });

  test("C: two users open the same project and edit the same file", async () => {
    await openFile(owner, "main.ts");
    await openFile(editor, "main.ts");
    await appendToEditor(owner, "\nconst alphaE2E = 41 + 1;");
    await expectEditorToContain(editor, "alphaE2E");
    await appendToEditor(editor, "\nconst betaE2E = 2;");
    await expectEditorToContain(owner, "betaE2E");
  });

  test("D: both users see synchronized changes, presence and remote cursors", async () => {
    // Presence: the owner's header shows the editor as live.
    await expect(owner.locator('[title^="E2E Editor"][title*="live now"]')).toBeVisible();
    await expect(editor.locator('[title^="E2E Owner"][title*="live now"]')).toBeVisible();
    // Remote cursor: the editor places a selection; the owner renders the
    // y-monaco remote-selection decoration for it.
    await editor.locator(".monaco-editor").click();
    await editor.keyboard.press("Control+End");
    await editor.keyboard.type(" ");
    await editor.keyboard.press("Backspace");
    await expect(async () => {
      const count = await owner.locator('[class*="yRemoteSelectionHead"]').count();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
    // Synchronized text is asserted in scenario C; re-check final state.
    await expectEditorToContain(owner, "alphaE2E");
    await expectEditorToContain(owner, "betaE2E");
  });

  test("E: user executes Python code and sees the output", async () => {
    await owner.getByRole("button", { name: "New file" }).click();
    const nameInput = owner.getByLabel("New file name");
    await nameInput.fill("hello.py");
    await nameInput.press("Enter");
    await openFile(owner, "hello.py");
    await typeInEditor(owner, "print(40 + 2)");
    await owner.getByRole("button", { name: /^Run$/ }).click();
    await expect(owner.getByText(/Exit code 0/)).toBeVisible({ timeout: 30_000 });
    await expect(owner.getByText("42", { exact: true }).first()).toBeVisible();
  });

  test("F: user restores a previous version", async () => {
    await openFile(owner, "main.ts");
    await expectEditorToContain(owner, "alphaE2E");
    // Snapshot the current state with a label.
    await owner.getByRole("button", { name: /History/ }).click();
    await owner.getByLabel("Snapshot label (optional)").fill("E2E snap");
    await owner.getByRole("button", { name: /Create snapshot/ }).click();
    await expect(owner.getByText(/Snapshot .* created\./)).toBeVisible();
    await owner.getByRole("button", { name: "Close version history" }).click();
    // Edit beyond the snapshot.
    await appendToEditor(owner, "\nconst postSnapE2E = 0;");
    await expectEditorToContain(owner, "postSnapE2E");
    // Restore the labelled snapshot (confirmation first).
    await owner.getByRole("button", { name: /History/ }).click();
    const row = owner.locator("li", { hasText: "E2E snap" });
    await row.getByRole("button", { name: /^Restore version/ }).click();
    await owner.getByRole("button", { name: "Restore this version" }).click();
    await expect(owner.getByText("Restored — a snapshot of the previous content was saved.")).toBeVisible();
    await owner.getByRole("button", { name: "Close version history" }).click();
    // The editor now shows the snapshot state: alpha present, post-snap edit gone.
    await expect(async () => {
      const text = await editorText(owner);
      expect(text).toContain("alphaE2E");
      expect(text).not.toContain("postSnapE2E");
    }).toPass({ timeout: 20_000 });
  });

  test("G: a VIEWER cannot edit or execute unauthorized operations", async () => {
    const inviteUrl = await inviteByEmail(owner, viewerEmail, "VIEWER");
    await owner.keyboard.press("Escape");
    await registerUser(viewer, { name: "E2E Viewer", email: viewerEmail });
    await acceptInvite(viewer, inviteUrl);
    await openFile(viewer, "main.ts");
    await expectEditorToContain(viewer, "alphaE2E");
    // Run is disabled for viewers.
    await expect(viewer.getByRole("button", { name: /^Run$/ })).toBeDisabled();
    // Typing does not change the (read-only) document.
    const before = await editorText(viewer);
    await viewer.locator(".monaco-editor").click();
    await viewer.keyboard.type("HACKED");
    await viewer.waitForTimeout(750);
    expect(await editorText(viewer)).toBe(before);
    // A direct API attempt to create a file is refused with 403.
    const status = await viewer.evaluate(async () => {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("cc_csrf="))
        ?.split("=")[1];
      const projectId = window.location.pathname.split("/").pop() ?? "";
      const res = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf ?? "" },
        body: JSON.stringify({ name: "evil.ts", type: "FILE", content: "x" }),
      });
      return res.status;
    });
    expect(status).toBe(403);
  });
});
