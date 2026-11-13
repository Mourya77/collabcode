import { Link } from "react-router-dom";
import { buttonVariants } from "../components/ui/button";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 text-center dark:bg-zinc-950">
      <p className="font-mono text-sm text-zinc-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">The page you are looking for does not exist or may have moved.</p>
      <Link to="/" className={buttonVariants({ className: "mt-6" })}>Back to home</Link>
    </main>
  );
}
