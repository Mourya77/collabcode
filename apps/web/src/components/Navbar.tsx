import type { ReactNode } from "react";
import { UserMenu } from "./UserMenu";

export function Navbar({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex min-w-0 items-center gap-3">
        {title && <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>}
        {children}
      </div>
      <UserMenu />
    </header>
  );
}
