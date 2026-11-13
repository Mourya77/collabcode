import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { initialsOf } from "./CollaboratorAvatars";

export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  if (!user) return null;

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="User profile menu"
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-zinc-800"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-[11px] font-semibold text-white">
            {initialsOf(user.name)}
          </span>
          <span className="hidden max-w-[140px] truncate font-medium text-zinc-800 dark:text-zinc-100 md:block">{user.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[200px] rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <DropdownMenu.Label className="px-2 py-1.5">
            <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">{user.name}</span>
            <span className="block truncate text-xs text-zinc-500">{user.email}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          <DropdownMenu.Item
            onSelect={() => navigate("/settings")}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-700 outline-none data-[highlighted]:bg-zinc-100 dark:text-zinc-200 dark:data-[highlighted]:bg-zinc-800"
          >
            <Settings className="h-4 w-4" aria-hidden /> Settings
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void handleLogout()}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-700 outline-none data-[highlighted]:bg-zinc-100 dark:text-zinc-200 dark:data-[highlighted]:bg-zinc-800"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
