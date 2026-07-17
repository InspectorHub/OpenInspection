import { useState, useEffect } from "react";
import { useLoaderData, useActionData, useNavigation, useFetcher, Form } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-integrations-qbo";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { getApiUrl } from "~/lib/api.server";
import { SecretField } from "~/components/SecretField";
import { m } from "~/paraglide/messages";

interface QboStatus {
  connected: boolean;
  companyName?: string;
  syncEnabled?: boolean;
  lastSyncAt?: number | null;
  openErrors?: number;
  refreshTokenExpiresAt?: number;
}

export function meta() {
  return [{ title: m.settings_qbo_meta_title() }];
}

type BffEnv = { API_WORKER?: { fetch: typeof fetch } };

async function qboApiFetch(
  context: Route.LoaderArgs["context"],
  cookie: string,
  path: string,
  method = "GET",
): Promise<Response | null> {
  try {
    const env = (context.cloudflare?.env ?? {}) as BffEnv;
    const apiBase = getApiUrl(context);
    const req = new Request(`${apiBase}/settings/integrations/qbo${path}`, {
      method,
      headers: { Cookie: cookie },
    });
    return env.API_WORKER ? env.API_WORKER.fetch(req) : fetch(req);
  } catch {
    return null;
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const cookie = request.headers.get("Cookie") ?? "";

  const [qboRes, secretsRes] = await Promise.all([
    qboApiFetch(context, cookie, "/status"),
    api.secrets.secrets.$get().catch(() => null),
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
  const intent = fd.get("intent") as string | null;
  const cookie = request.headers.get("Cookie") ?? "";

  if (intent === "save-qbo-secrets") {
    const body: Record<string, string> = {};
    for (const key of ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_WEBHOOK_SECRET"] as const) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const api = createApi(context, { token });
      const res = await api.secrets.secrets.$put({ json: body });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        return {
          success: false,
          intent,
          error: errBody?.error?.message ?? m.settings_qbo_save_error(),
          syncEnabled: undefined,
        };
      }
    }
    return { success: true, intent, error: null, syncEnabled: undefined };
  }

  if (intent === "qbo-sync" || intent === "qbo-pause" || intent === "qbo-disconnect") {
    const path = intent === "qbo-sync" ? "/sync" : intent === "qbo-pause" ? "/pause" : "/disconnect";
    const res = await qboApiFetch(context, cookie, path, "POST");
    if (!res?.ok) return { success: false, intent, error: m.settings_qbo_action_failed({ intent }), syncEnabled: undefined };

    if (intent === "qbo-pause") {
      const body = await res.json() as { data?: { syncEnabled?: boolean } };
      return { success: true, intent, error: null, syncEnabled: body?.data?.syncEnabled };
    }
    return { success: true, intent, error: null, syncEnabled: undefined };
  }

  return { success: false, intent, error: m.settings_unknown_action(), syncEnabled: undefined };
}

function timeSince(ts: number | null | undefined): string {
  if (!ts) return m.settings_qbo_time_never();
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return m.settings_qbo_time_just_now();
  if (diff < 3600) return m.settings_qbo_time_minutes_ago({ minutes: Math.floor(diff / 60) });
  return m.settings_qbo_time_hours_ago({ hours: Math.floor(diff / 3600) });
}

export default function SettingsIntegrationsQbo() {
  const { status: initial, secrets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [status, setStatus] = useState<QboStatus | null>(initial);

  const savingSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-qbo-secrets";

  // Transient success flash — visible for 4s after a save round-trip.
  const [flashVisible, setFlashVisible] = useState(false);
  useEffect(() => {
    if (actionData?.success && actionData.intent === "save-qbo-secrets") {
      setFlashVisible(true);
      const t = setTimeout(() => setFlashVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [actionData]);
  const qboFetcher = useFetcher<{ success: boolean; intent?: string | null; error: string | null; syncEnabled?: boolean }>();

  const connected = status?.connected;
  const syncing = qboFetcher.state !== "idle" && qboFetcher.formData?.get("intent") === "qbo-sync";
  const expiryWarning =
    status?.refreshTokenExpiresAt &&
    status.refreshTokenExpiresAt <
      Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

  useEffect(() => {
    const d = qboFetcher.data;
    if (!d?.success) return;
    if (d.intent === "qbo-pause") {
      setStatus((s) => (s ? { ...s, syncEnabled: d.syncEnabled } : s));
    } else if (d.intent === "qbo-disconnect") {
      setStatus(null);
    }
  }, [qboFetcher.data]);

  function triggerSync() {
    qboFetcher.submit({ intent: "qbo-sync" }, { method: "POST" });
  }

  function togglePause() {
    qboFetcher.submit({ intent: "qbo-pause" }, { method: "POST" });
  }

  function disconnect() {
    qboFetcher.submit({ intent: "qbo-disconnect" }, { method: "POST" });
  }

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb
        items={[
          { label: m.settings_crumb_root(), href: "/settings" },
          { label: m.settings_integrations_crumb(), href: "/settings/integrations" },
          { label: m.settings_qbo_crumb() },
        ]}
      />

      {/* Flash */}
      {flashVisible && actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {m.settings_qbo_flash_saved()}
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      )}

      {/* QBO API credentials */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_qbo_api_credentials_heading()}</h3>
        <p className="text-[13px] text-ih-fg-3">
          {m.settings_qbo_credentials_desc_before()}{" "}
          <a href="https://developer.intuit.com/app/developer/appdetail" target="_blank" rel="noopener noreferrer"
            className="text-ih-primary hover:underline">
            {m.settings_qbo_credentials_link()}
          </a>.
        </p>
        <Form method="post" className="space-y-4 max-w-xl">
          <input type="hidden" name="intent" value="save-qbo-secrets" />
          <SecretField
            name="QBO_CLIENT_ID"
            label={m.settings_qbo_client_id_label()}
            value={secrets.QBO_CLIENT_ID}
            hint={m.settings_qbo_client_id_hint()}
          />
          <SecretField
            name="QBO_CLIENT_SECRET"
            label={m.settings_qbo_client_secret_label()}
            value={secrets.QBO_CLIENT_SECRET}
            hint={m.settings_qbo_client_secret_hint()}
          />
          <SecretField
            name="QBO_WEBHOOK_SECRET"
            label={m.settings_qbo_webhook_label()}
            value={secrets.QBO_WEBHOOK_SECRET}
            hint={m.settings_qbo_webhook_hint()}
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit" disabled={savingSecrets}
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {savingSecrets ? m.common_saving() : m.settings_qbo_save_credentials()}
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
            {m.settings_qbo_expiry_warning()}{" "}
            <a href="/settings/integrations/qbo/connect" className="underline font-semibold">
              {m.settings_qbo_reconnect_link()}
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
            {m.settings_qbo_connect_heading()}
          </h3>
          <ul className="text-[13px] text-ih-fg-3 text-left max-w-xs mx-auto mb-6 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_sync()}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_payments()}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_dedup()}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_void()}
            </li>
          </ul>
          <a
            href="/settings/integrations/qbo/connect"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#2CA01C] text-white rounded-lg font-bold text-[13px] hover:bg-[#237a16] transition-colors"
          >
            {m.settings_qbo_connect_button()}
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
                  {status.companyName ?? m.settings_qbo_connected_fallback()}
                </p>
                <p className="text-[12px] text-ih-fg-3 mt-0.5">
                  {m.settings_qbo_last_synced({ time: timeSince(status.lastSyncAt) })}
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
 ? "bg-ih-ok"
 : "bg-ih-fg-4"
 }`}
                />
                {status.syncEnabled ? m.settings_qbo_status_active() : m.settings_qbo_status_paused()}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={triggerSync}
                disabled={syncing}
                className="px-4 py-2 text-[12px] font-bold bg-ih-primary-tint text-ih-primary rounded-md hover:bg-ih-primary-tint transition-colors disabled:opacity-50"
              >
                {syncing ? m.settings_qbo_syncing() : m.settings_qbo_sync_now()}
              </button>
              <button
                onClick={togglePause}
                className="px-4 py-2 text-[12px] font-bold bg-ih-bg-muted text-ih-fg-2 rounded-md hover:bg-ih-bg-muted transition-colors"
              >
                {status.syncEnabled ? m.settings_qbo_pause_sync() : m.settings_qbo_resume_sync()}
              </button>
              <button
                onClick={disconnect}
                className="px-4 py-2 text-[12px] font-bold text-ih-bad-fg hover:bg-ih-bad-bg rounded-md transition-colors"
              >
                {m.settings_qbo_disconnect()}
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
                {m.settings_qbo_sync_errors({ count: status.openErrors ?? 0 })}
              </h3>
              <p className="text-[12px] text-ih-fg-3">
                {m.settings_qbo_sync_errors_desc()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
