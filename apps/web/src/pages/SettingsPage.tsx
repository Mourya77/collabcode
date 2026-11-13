import { useState, type FormEvent } from "react";
import { AppLayout } from "../components/AppLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuthStore } from "../stores/authStore";
import { useEditorStore } from "../stores/editorStore";
import { useUiStore } from "../stores/uiStore";
import { ErrorBanner } from "./AuthForm";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const fontSize = useEditorStore((s) => s.fontSize);
  const setFontSize = useEditorStore((s) => s.setFontSize);
  const [name, setName] = useState(user?.name ?? "");
  const [saved, setSaved] = useState(false);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await updateProfile(name);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  if (!user) return null;
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <AppLayout title="Settings">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>

        <Section title="Profile" description="How you appear to collaborators.">
          <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-4">
            <ErrorBanner message={error} />
            <div className="space-y-1.5">
              <Label htmlFor="settings-name">Display name</Label>
              <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isLoading || !name.trim()}>{isLoading ? "Saving…" : "Save profile"}</Button>
              {saved && <span role="status" className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span>}
            </div>
          </form>
        </Section>

        <Section title="Appearance" description="Theme and editor preferences are saved in this browser.">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Currently using the {theme} theme.</p>
            </div>
            <div role="group" aria-label="Theme" className="flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={theme === t}
                  onClick={() => setTheme(t)}
                  className={`rounded px-3 py-1.5 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${theme === t ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-zinc-500"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="editor-font-size">Editor font size</Label>
            <select
              id="editor-font-size"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {[12, 13, 14, 15, 16, 18, 20].map((px) => (
                <option key={px} value={px}>{px}px</option>
              ))}
            </select>
          </div>
        </Section>

        <Section title="Account" description="Your account details from the Phase 1 development login.">
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">Email</dt><dd>{user.email}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">Member since</dt><dd>{memberSince}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">Account id</dt><dd className="truncate font-mono text-xs leading-5">{user.id}</dd></div>
          </dl>
        </Section>
      </div>
    </AppLayout>
  );
}
