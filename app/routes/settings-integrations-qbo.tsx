import { useState } from "react";
import { useLoaderData, useActionData, Link, Form } from "react-router";
import type { Route } from "./+types/settings-integrations-qbo";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";

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

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  const [qboRes, secretsRes] = await Promise.all([
    fetch("/settings/integrations/qbo/status", { credentials: "include" }).catch(() => null),
    api.admin.secrets.$get().catch(() => null),
  ]);

  let status: QboStatus | null = null;
  if (qboRes?.ok) {
    const body = await qboRes.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    status = (Object.keys(d).length > 0 ? d : null) as QboStatus | null;
  }

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  return {
    status,
    secrets: {
      QBO_CLIENT_ID: secrets.QBO_CLIENT_ID || "",
      QBO_CLIENT_SECRET: secrets.QBO_CLIENT_SECRET || "",
      QBO_WEBHOOK_SECRET: secrets.QBO_WEBHOOK_SECRET || "",
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "save-qbo-secrets") {
    const body: Record<string, string> = {};
    for (const key of ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_WEBHOOK_SECRET"] as const) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const api = createApi(context, { token });
      const res = await api.admin.secrets.$put({ json: body });
      if (!res.ok) {
        return { success: false, error: "Failed to save QBO keys." };
      }
    }
    return { success: true, error: null };
  }

  return { success: false, error: "Unknown action" };
}

function timeSince(ts: number | null | undefined): string {
  if (!ts) return "Never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  return `${Math.floor(diff / 3600)} hours ago`;
}

export default function SettingsIntegrationsQbo() {
  const { status: initial, secrets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
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

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          QBO credentials saved.
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      )}

      {/* QBO API credentials */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">API credentials</h3>
        <p className="text-[13px] text-ih-fg-3">
          OAuth credentials from your QuickBooks Developer app. Required before connecting.
          Get them at{" "}
          <a href="https://developer.intuit.com/app/developer/appdetail" target="_blank" rel="noopener noreferrer"
            className="text-ih-primary hover:underline">
            developer.intuit.com
          </a>.
        </p>
        <Form method="post" className="space-y-4 max-w-xl">
          <input type="hidden" name="intent" value="save-qbo-secrets" />
          <SecretField
            name="QBO_CLIENT_ID"
            label="QBO Client ID"
            value={secrets.QBO_CLIENT_ID}
            hint="QuickBooks Online integration for invoice sync. Create at developer.intuit.com → My Apps"
          />
          <SecretField
            name="QBO_CLIENT_SECRET"
            label="QBO Client Secret"
            value={secrets.QBO_CLIENT_SECRET}
            hint="Paired with Client ID. Found in the same Intuit app settings"
          />
          <SecretField
            name="QBO_WEBHOOK_SECRET"
            label="QBO Webhook Verifier Token"
            value={secrets.QBO_WEBHOOK_SECRET}
            hint="Verifies QuickBooks data change notifications. Found at developer.intuit.com → Webhooks"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit"
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Save credentials
            </button>
          </div>
        </Form>
      </section>

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
