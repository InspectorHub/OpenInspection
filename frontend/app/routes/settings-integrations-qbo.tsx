import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/settings-integrations-qbo";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { extractObject } from "~/lib/api-helpers";

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
    const body = await res.json();
    const d = extractObject(body);
    return { status: (Object.keys(d).length > 0 ? d : null) as QboStatus | null };
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
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link
          to="/settings"
          className="hover:text-ih-primary transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <Link
          to="/settings/integrations"
          className="hover:text-ih-primary transition-colors"
        >
          Integrations
        </Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">
          QuickBooks Online
        </span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">
        QuickBooks Online
      </h2>

      {/* Expiry warning */}
      {connected && expiryWarning && (
        <div className="flex items-start gap-3 p-4 bg-ih-watch-bg border border-ih-watch-fg/20 rounded-lg text-ih-watch-fg text-[13px]">
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
        <div className="bg-ih-bg-card border border-ih-border rounded-lg p-8 text-center">
          <div className="w-16 h-16 bg-[#2CA01C]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-[#2CA01C] text-2xl font-extrabold">QB</span>
          </div>
          <h3 className="text-[16px] font-bold text-ih-fg-1 mb-2">
            Connect QuickBooks Online
          </h3>
          <ul className="text-[13px] text-ih-fg-3 text-left max-w-xs mx-auto mb-6 space-y-2">
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
          <div className="bg-ih-bg-card border border-ih-border rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-bold text-[14px] text-ih-fg-1">
                  {status.companyName ?? "Connected"}
                </p>
                <p className="text-[12px] text-ih-fg-3 mt-0.5">
                  Last synced: {timeSince(status.lastSyncAt)}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
 status.syncEnabled
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
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
                className="px-4 py-2 text-[12px] font-bold bg-ih-primary-tint text-ih-primary rounded-md hover:bg-ih-primary-tint transition-colors disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                onClick={togglePause}
                className="px-4 py-2 text-[12px] font-bold bg-ih-bg-muted text-ih-fg-2 rounded-md hover:bg-ih-bg-muted transition-colors"
              >
                {status.syncEnabled ? "Pause Sync" : "Resume Sync"}
              </button>
              <button
                onClick={disconnect}
                className="px-4 py-2 text-[12px] font-bold text-ih-bad-fg hover:bg-ih-bad-bg rounded-md transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>

          {/* Sync errors */}
          {(status.openErrors ?? 0) > 0 && (
            <div className="bg-ih-bg-card border border-ih-bad rounded-lg p-6">
              <h3 className="font-bold text-[14px] text-ih-fg-1 mb-2 flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-ih-bad-fg"
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
              <p className="text-[12px] text-ih-fg-3">
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
