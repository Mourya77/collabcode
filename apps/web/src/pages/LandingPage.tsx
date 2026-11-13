import { Code2, GitBranch, MessagesSquare, Play, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonVariants } from "../components/ui/button";
import { ServiceStatus } from "../components/ServiceStatus";
import { useAuthStore } from "../stores/authStore";

const FEATURES = [
  { icon: Users, title: "Real-time collaboration", text: "Share a workspace link and code together with live cursors and presence — powered by Yjs CRDTs (arriving in Phase 3)." },
  { icon: Code2, title: "A real editor", text: "Monaco, the editor behind VS Code, with syntax highlighting for TypeScript, Python, Java, C++ and more." },
  { icon: Play, title: "Run your code", text: "Execute projects in an isolated sandbox with per-language runners, timeouts and resource limits (Phase 5)." },
  { icon: MessagesSquare, title: "Chat where you code", text: "Project chat sits next to the editor so discussion stays with the code (Phase 4)." },
  { icon: GitBranch, title: "Version history", text: "Every file keeps document versions you can revisit — no work is ever silently lost." },
  { icon: Zap, title: "Instant workspaces", text: "Create a project and start typing in seconds. No local setup, no toolchain wrangling." },
];

const STEPS = [
  { n: "1", title: "Create a workspace", text: "Start a project and get a file tree with starter files you can edit right away." },
  { n: "2", title: "Invite your team", text: "Share the workspace link. Teammates join with their own account and role." },
  { n: "3", title: "Build together", text: "Edit the same files at the same time, chat in context, and run the result." },
];

const TECH = ["React", "TypeScript", "Monaco Editor", "Yjs + Hocuspocus", "Node.js + Express", "PostgreSQL + Prisma", "Redis", "Docker"];

export default function LandingPage() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Code2 className="h-5 w-5 text-sky-500" aria-hidden /> CollabCode
        </span>
        <nav className="flex items-center gap-2" aria-label="Landing">
          {user ? (
            <Link to="/dashboard" className={buttonVariants()}>Open dashboard</Link>
          ) : (
            <>
              <Link to="/login" className={buttonVariants({ variant: "ghost" })}>Log in</Link>
              <Link to="/register" className={buttonVariants()}>Sign up</Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Code together, in real time, from anywhere
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            CollabCode is a browser-based collaborative IDE: shared workspaces, a professional editor,
            team chat and code execution — like Replit, VS Code and Google Docs in one place.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Link to="/dashboard" className={buttonVariants({ className: "h-11 px-6 text-base" })}>Go to your dashboard</Link>
            ) : (
              <>
                <Link to="/register" className={buttonVariants({ className: "h-11 px-6 text-base" })}>Create your account</Link>
                <Link to="/login" className={buttonVariants({ variant: "outline", className: "h-11 px-6 text-base" })}>Log in</Link>
              </>
            )}
          </div>
          <div className="mt-8 flex justify-center">
            <ServiceStatus />
          </div>
        </section>

        <section aria-labelledby="features-heading" className="py-10">
          <h2 id="features-heading" className="text-2xl font-semibold tracking-tight">Everything a small team needs</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <Icon className="h-5 w-5 text-sky-500" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="how-heading" className="py-10">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">How collaboration works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-sm font-semibold text-white">{s.n}</span>
                <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="tech-heading" className="py-10 pb-20">
          <h2 id="tech-heading" className="text-2xl font-semibold tracking-tight">Built on a serious stack</h2>
          <ul className="mt-5 flex flex-wrap gap-2">
            {TECH.map((t) => (
              <li key={t} className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{t}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-6 dark:border-zinc-800">
        <p className="mx-auto max-w-6xl px-4 text-sm text-zinc-500 dark:text-zinc-400">CollabCode — a collaborative IDE, built phase by phase.</p>
      </footer>
    </div>
  );
}
