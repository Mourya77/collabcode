import { useEffect } from "react";
import type { HealthStatus } from "@collabcode/shared";
import { useUiStore } from "../stores/uiStore";

/**
 * Same base-URL rule as the API client: an unset VITE_API_URL means
 * "same origin" (the dev/preview server proxies /api), NOT a hardcoded
 * localhost URL — the old default broke the indicator whenever the page
 * was served from any other origin.
 */
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export async function fetchApiHealth(fetcher: typeof fetch = fetch): Promise<HealthStatus> {
  const r = await fetcher(`${API_URL}/api/health`);
  if (!r.ok) throw new Error(`API health ${r.status}`);
  return (await r.json()) as HealthStatus;
}

/**
 * Real API health indicator. Fetches GET /health from @collabcode/api and
 * shows loading / ok / down. Never reports a mocked success.
 */
export function ServiceStatus() {
  const apiStatus = useUiStore((s) => s.apiStatus);
  const setApiStatus = useUiStore((s) => s.setApiStatus);
  useEffect(() => {
    let cancelled = false;
    fetchApiHealth()
      .then((h) => { if (!cancelled) setApiStatus(h.status === "ok" ? "ok" : "down"); })
      .catch(() => { if (!cancelled) setApiStatus("down"); });
    return () => { cancelled = true; };
  }, [setApiStatus]);

  const dot =
    apiStatus === "ok" ? "bg-emerald-500" : apiStatus === "down" ? "bg-red-500" : "bg-amber-400 animate-pulse";
  const label =
    apiStatus === "ok"
      ? "API status: ok"
      : apiStatus === "down"
        ? "API status: down — start @collabcode/api on port 4000"
        : "Checking API…";
  return (
    <span
      data-testid="api-status"
      className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
