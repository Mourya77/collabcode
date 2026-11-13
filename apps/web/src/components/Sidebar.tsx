import { Code2, FolderKanban, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useUiStore } from "../stores/uiStore";
import { cn } from "../lib/utils";

const LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  return (
    <aside
      aria-label="Primary"
      className={cn(
        "flex shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-[width] dark:border-zinc-800 dark:bg-zinc-900",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <Code2 className="h-5 w-5 shrink-0 text-sky-500" aria-hidden />
        {!collapsed && <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">CollabCode</span>}
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
                isActive
                  ? "bg-zinc-200 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {!collapsed && label}
          </NavLink>
        ))}
        <div
          className={cn("flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-400 dark:text-zinc-500")}
          title="Projects live on the dashboard"
        >
          <FolderKanban className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && "Projects"}
        </div>
      </nav>
      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
