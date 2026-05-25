import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/settings-integrations-qbo";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

interface QboStatus {
  connected: boolean;
  companyName?: string;
  syncEnabled?: boolean;
  lastSyncAt?: number | null;
  openErrors?: number;
  refreshTokenExpiresAt?: number;
}

export function meta() {
  return [{ title: "QuickBooks Integration - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/qbo/status", { token });
    if (!res.ok) return { status: null };
    const json = (await res.json()) as { data?: QboStatus };
    return { status: json.data ?? null };
  } catch {
    return { status: null };
  }
}

function timeSince(ts: number | null | undefined): string {
  if (!ts) return "Never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  return `${Math.floor(diff / 3600)} hours ago`;
}

export default function SettingsIntegrationsQbo() {
  const { status: initial } = useLoaderData<typeof loader>();
  const [status, setStatus] = useState<QboStatus | null>(initial);
  const [syncing, setSyncing] = useState(false);

  const connected = status?.connected;
  const expiryWarning =
    status?.refreshTokenExpiresAt &&
    status.refreshTokenExpiresAt <
      Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

  async function triggerSync() {
    setSyncing(true);
    await fetch("/api/qbo/sync", { method: "POST", credentials: "same-origin" });
    setSyncing(false);
  }

  async function togglePause() {
    const res = await fetch("/api/qbo/pause", {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.ok) {
      const json = (await res.json()) as { syncEnabled?: boolean };
      setStatus((s) => (s ? { ...s, syncEnabled: json.syncEnabled } : s));
    }
  }

  async function disconnect() {
    // Uses a simple confirm for now; will be replaced with a custom modal
    await fetch("/api/qbo/disconnect", {
      method: "POST",
      credentials: "same-origin",
    });
    setStatus(null);
  }

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link
          to="/settings"
          className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <Link
          to="/settings/integrations"
          className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          Integrations
        </Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">
          QuickBooks Online
        </span>
      </div>

      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">
        QuickBooks Online
      </h2>

      {/* Expiry warning */}
      {connected && expiryWarning && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-[13px]">
          <svg
            className="w-5 h-5 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            Your QuickBooks connection expires soon.{" "}
            <a href="/api/qbo/connect" className="underline font-semibold">
              Reconnect to avoid interruption.
            </a>
          </span>
        </div>
      )}

      {/* Not connected */}
      {!connected && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center">
          <div className="w-16 h-16 bg-[#2CA01C]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-[#2CA01C] text-2xl font-extrabold">QB</span>
          </div>
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100 mb-2">
            Connect QuickBooks Online
          </h3>
          <ul className="text-[13px] text-slate-600 dark:text-slate-400 text-left max-w-xs mx-auto mb-6 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 mt-0.5">&#x2713;</span> Real-time
              invoice sync
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 mt-0.5">&#x2713;</span> Automatic
              payment status updates
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 mt-0.5">&#x2713;</span> Duplicate
              customer detection
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 mt-0.5">&#x2713;</span> Invoice
              void and refund sync
            </li>
          </ul>
          <a
            href="/api/qbo/connect"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#2CA01C] text-white rounded-lg font-bold text-[13px] hover:bg-[#237a16] transition-colors"
          >
            Connect QuickBooks
          </a>
        </div>
      )}

      {/* Connected */}
      {connected && (
        <div className="space-y-4">
          {/* Status card */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-bold text-[14px] text-slate-900 dark:text-slate-100">
                  {status.companyName ?? "Connected"}
                </p>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  Last synced: {timeSince(status.lastSyncAt)}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
                  status.syncEnabled
                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    status.syncEnabled
                      ? "bg-emerald-500"
                      : "bg-slate-400"
                  }`}
                />
                {status.syncEnabled ? "Active" : "Paused"}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={triggerSync}
                disabled={syncing}
                className="px-4 py-2 text-[12px] font-bold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                onClick={togglePause}
                className="px-4 py-2 text-[12px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                {status.syncEnabled ? "Pause Sync" : "Resume Sync"}
              </button>
              <button
                onClick={disconnect}
                className="px-4 py-2 text-[12px] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>

          {/* Sync errors */}
          {(status.openErrors ?? 0) > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 rounded-lg p-6">
              <h3 className="font-bold text-[14px] text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Sync Errors ({status.openErrors})
              </h3>
              <p className="text-[12px] text-slate-500">
                Check the sync error log for details. Errors will retry
                automatically on the next sync.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
