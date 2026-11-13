import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Sandbox limitation: Chromium here cannot open a proxy tunnel to
 * cdn.jsdelivr.net (ERR_TUNNEL_CONNECTION_FAILED on every proxy variant,
 * while curl through the same proxy succeeds). The app loads Monaco from
 * that CDN, so for E2E the CDN URLs are fulfilled from the REAL
 * monaco-editor package installed in apps/web/node_modules (the same
 * `min/vs` AMD tree the CDN serves). The application itself is untouched,
 * and every other request (app bundle, REST, WebSockets) is real.
 */
const MONACO_VS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/node_modules/monaco-editor/min/vs",
);
const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export async function serveMonacoFromLocalPackage(context: BrowserContext): Promise<void> {
  await context.route("https://cdn.jsdelivr.net/npm/monaco-editor@*/min/vs/**", async (route) => {
    const rel = new URL(route.request().url()).pathname.split("/min/vs/")[1] ?? "";
    const file = path.join(MONACO_VS_DIR, rel);
    if (!file.startsWith(MONACO_VS_DIR) || !fs.existsSync(file)) {
      await route.abort();
      return;
    }
    await route.fulfill({
      body: fs.readFileSync(file),
      contentType: CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    });
  });
}

/** Unique identities per run — the E2E database persists across tests in the suite. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
let seq = 0;

export function uniqueEmail(label: string): string {
  seq += 1;
  return `e2e.${label}.${RUN}.${seq}@example.com`;
}

export const PASSWORD = "password123";

export async function registerUser(
  page: Page,
  args: { name: string; email: string; password?: string },
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Name").fill(args.name);
  await page.getByLabel("Email").fill(args.email);
  await page.getByLabel("Password", { exact: true }).fill(args.password ?? PASSWORD);
  await page.getByLabel("Confirm password", { exact: true }).fill(args.password ?? PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Create project" }).first().click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).last().click();
  await expect(page).toHaveURL(/\/workspace\//);
}

export async function openFile(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Open file ${name}` }).click();
}

/** Visible editor text (Monaco renders the file's lines; our files are small).
 *  Monaco renders spaces as non-breaking spaces — normalize them back. */
export async function editorText(page: Page): Promise<string> {
  const raw = await page.locator(".monaco-editor .view-lines").innerText();
  return raw.replace(/\u00A0/g, " ");
}

export async function expectEditorToContain(page: Page, text: string): Promise<void> {
  await expect(async () => {
    expect(await editorText(page)).toContain(text);
  }).toPass({ timeout: 20_000 });
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator(".monaco-editor").click();
  await page.keyboard.type(text, { delay: 15 });
}

export async function appendToEditor(page: Page, text: string): Promise<void> {
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text, { delay: 15 });
}

/**
 * Sends an invitation from the open workspace and returns the dev-mode
 * invite URL shown in the modal (email delivery is not configured in dev —
 * Phase 4 design). The modal stays open; the caller closes it if needed.
 */
export async function inviteByEmail(page: Page, email: string, role: "EDITOR" | "VIEWER"): Promise<string> {
  await page.getByRole("button", { name: /Invite/ }).click();
  await page.getByLabel("Invite by email").fill(email);
  await page.getByLabel("Role").selectOption(role);
  await page.getByRole("button", { name: "Send invitation" }).click();
  const link = page.getByLabel("Invitation link", { exact: true });
  await expect(link).toHaveValue(/\/invite\//);
  return link.inputValue();
}

export async function acceptInvite(page: Page, inviteUrl: string): Promise<void> {
  const path = new URL(inviteUrl).pathname;
  await page.goto(path);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/workspace\//);
}
