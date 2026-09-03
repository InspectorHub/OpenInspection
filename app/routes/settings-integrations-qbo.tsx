import { useState, useEffect } from "react";
import { useLoaderData, useActionData, useNavigation } from "react-router";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-integrations-qbo";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { getApiUrl } from "~/lib/api.server";
import { m } from "~/paraglide/messages";
import { getCloudflareEnv } from "~/lib/load-context";
import { getDeploymentProfile } from "../../server/lib/deployment-profile";
import { QboConnectionPanel } from "~/components/settings/QboConnectionPanel";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { QboCredentialsForm } from "~/components/settings/QboCredentialsForm";
import { QboConnectCard } from "~/components/settings/QboConnectCard";
import {
  QboOAuthOutcomeBanner,
  type QboOAuthOutcome,
} from "~/components/settings/QboOAuthOutcome";
import type { QBOConnectionStatus } from "../../server/services/qbo/api-base";

/**
 * The connection is represented by presence, not by a flag: `/status` answers
 * with the connection or with nothing, so `status === null` IS "not connected".
 *
 * This page used to re-declare the payload locally with an extra
 * `connected: boolean` and cast the JSON body to it. No such field is ever
 * sent, so the flag read `undefined` forever and every connected-state control
 * on this page was unreachable. Read the server's own type instead, so a
 * divergence is a compile error rather than a blank page.
 */
export interface QboLoaderData {
  status: QBOConnectionStatus | null;
  secrets: {
    QBO_CLIENT_ID: string;
    QBO_CLIENT_SECRET: string;
    QBO_WEBHOOK_SECRET: string;
    QBO_ENV: string;
  };
  /**
   * Whether this tenant supplies their own Intuit app.
   *
   * On a platform deployment they never do, and the credential form is not a
   * thing we hide from them — it is a question they are never asked, because
   * one published app serves everyone. A self-hosted deploy answers on its own
   * domain, and Intuit matches a redirect URI byte for byte, so the platform's
   * app cannot work there whatever anyone prefers.
   *
   * Read from the deployment profile's capability, never from an APP_MODE
   * string compare.
   */
  selfHosted: boolean;
  /**
   * Which of the three the deployment already supplies through its Worker env.
   * Booleans only — the values themselves never leave the server.
   *
   * The stored-secret form above can only show what is in the tenant's own
   * row, so on a deployment that configures QuickBooks centrally all three
   * read empty while the integration works. Without this the page told a
   * working tenant they had configured nothing.
   */
  envProvided: {
    QBO_CLIENT_ID: boolean;
    QBO_CLIENT_SECRET: boolean;
    QBO_WEBHOOK_SECRET: boolean;
    QBO_ENV: boolean;
  };
  /**
   * How the OAuth handshake ended, read off the query string that
   * `api/qbo-oauth.ts` redirects back with. Both halves of that flow report
   * exclusively this way — `?connected=1`, or `?error=<code>` for a missing
   * credential, a missing/expired `state`, an unset `QBO_ENV`, a refused token
   * exchange, or a user who declined at Intuit. Nothing used to read any of
   * it, so every one of those outcomes returned the user to an unchanged page
   * with no explanation, successes included.
   */
  oauth: QboOAuthOutcome;
}

export function meta() {
  return [{ title: m.settings_qbo_meta_title() }];
}

async function qboApiFetch(
  context: Route.LoaderArgs["context"],
  cookie: string,
  path: string,
  method = "GET",
): Promise<Response | null> {
  try {
    const env = getCloudflareEnv(context);
    const apiBase = getApiUrl(context);
    const req = new Request(`${apiBase}/api/integrations/qbo${path}`, {
      method,
      headers: { Cookie: cookie },
    });
    return env.API_WORKER ? env.API_WORKER.fetch(req) : fetch(req);
  } catch {
    return null;
  }
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<QboLoaderData> {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const cookie = request.headers.get("Cookie") ?? "";

  const [qboRes, secretsRes] = await Promise.all([
    qboApiFetch(context, cookie, "/status"),
    api.secrets.secrets.$get().catch(() => null),
  ]);

  let status: QBOConnectionStatus | null = null;
  if (qboRes?.ok) {
    const body = await qboRes.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    status = (Object.keys(d).length > 0 ? d : null) as QBOConnectionStatus | null;
  }

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  const env = getCloudflareEnv(context);
  const url = new URL(request.url);
  const rawError = url.searchParams.get("error");

  return {
    status,
    secrets: {
      QBO_CLIENT_ID: secrets.QBO_CLIENT_ID || "",
      QBO_CLIENT_SECRET: secrets.QBO_CLIENT_SECRET || "",
      QBO_WEBHOOK_SECRET: secrets.QBO_WEBHOOK_SECRET || "",
      QBO_ENV: secrets.QBO_ENV || "",
    },
    selfHosted: !getDeploymentProfile(env).qboAppManaged,
    envProvided: {
      QBO_CLIENT_ID: Boolean(env.QBO_CLIENT_ID),
      QBO_CLIENT_SECRET: Boolean(env.QBO_CLIENT_SECRET),
      QBO_WEBHOOK_SECRET: Boolean(env.QBO_WEBHOOK_SECRET),
      QBO_ENV: Boolean(env.QBO_ENV),
    },
    oauth: {
      connected: url.searchParams.get("connected") === "1",
      // Bounded before it reaches the page: this value arrives from a
      // redirect anyone can craft, and the renderer must never be handed
      // arbitrary attacker text to echo back.
      error: rawError ? rawError.slice(0, 64) : null,
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
    for (const key of ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_WEBHOOK_SECRET", "QBO_ENV"] as const) {
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

  // Closing one open row. Kept out of the switch below because it is the only
  // QBO action that names a specific record, and the id must be validated here
  // rather than pasted into a path — this builds a URL.
  if (intent === "qbo-dismiss-error") {
    const errorId = String(fd.get("errorId") ?? "");
    if (!errorId) {
      return { success: false, intent, error: m.settings_unknown_action(), syncEnabled: undefined };
    }
    const res = await qboApiFetch(
      context, cookie, `/errors/${encodeURIComponent(errorId)}/dismiss`, "POST",
    );
    if (!res?.ok) return { success: false, intent, error: m.settings_qbo_action_failed({ intent }), syncEnabled: undefined, errorId: undefined };
    // The id travels back so the page can drop exactly the row the server
    // closed, rather than re-deriving it from client state.
    return { success: true, intent, error: null, syncEnabled: undefined, errorId };
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

export default function SettingsIntegrationsQbo() {
  const { status: initial, secrets, envProvided, oauth, selfHosted } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [status, setStatus] = useState<QBOConnectionStatus | null>(initial);

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
  const { fetcher: qboFetcher, submit: submitQbo, busy: qboBusy } =
    useGuardedSubmit<{
      success: boolean;
      intent?: string | null;
      error: string | null;
      syncEnabled?: boolean;
      /** Set only by `qbo-dismiss-error` — which row the server closed. */
      errorId?: string;
    }>();

  const discrepancies = status?.paymentDiscrepancies ?? [];
  const syncing = qboBusy && qboFetcher.formData?.get("intent") === "qbo-sync";
  const expiryWarning =
    status?.refreshTokenExpiresAt &&
    status.refreshTokenExpiresAt <
      Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

  useEffect(() => {
    const d = qboFetcher.data;
    if (!d?.success) return;
    if (d.intent === "qbo-pause") {
      // Only when the action reported the new state. A pause whose response
      // omitted it leaves the badge showing what we last knew, rather than
      // flipping it to a value nobody confirmed.
      const next = d.syncEnabled;
      if (typeof next === "boolean") setStatus((s) => (s ? { ...s, syncEnabled: next } : s));
    } else if (d.intent === "qbo-disconnect") {
      setStatus(null);
    } else if (d.intent === "qbo-dismiss-error" && d.errorId) {
      // Drop the row the server just closed. The id comes back on the action
      // result rather than being read from `dismissingId` here: that state is
      // cleared when the fetcher goes idle, and which of the two happens first
      // is not something this component should depend on.
      const closed = d.errorId;
      setStatus((s) => (s ? { ...s, openErrors: s.openErrors.filter((e) => e.id !== closed) } : s));
    }
  }, [qboFetcher.data]);

  function triggerSync() {
    submitQbo({ intent: "qbo-sync" }, { method: "POST" });
  }

  function togglePause() {
    submitQbo({ intent: "qbo-pause" }, { method: "POST" });
  }

  // Disconnect asks first. One click used to end the connection AND delete every
  // entity mapping — irreversible in the sense that matters: reconnecting does
  // not restore the links, so previously-synced records can be pushed again as
  // new ones. A custom dialog rather than `window.confirm`, which this codebase
  // does not use.
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  function disconnect() {
    setConfirmDisconnect(false);
    submitQbo({ intent: "qbo-disconnect" }, { method: "POST" });
  }

  // Which row is being closed, so only its own button reads as busy. Cleared on
  // the fetcher settling — including a FAILED dismiss, or the row would sit
  // disabled forever with no way to retry it.
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  useEffect(() => {
    if (qboFetcher.state === "idle") setDismissingId(null);
  }, [qboFetcher.state]);

  function dismissError(errorId: string) {
    setDismissingId(errorId);
    submitQbo({ intent: "qbo-dismiss-error", errorId }, { method: "POST" });
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

      <QboOAuthOutcomeBanner outcome={oauth} />

      {/* Only where the tenant owns the Intuit app. On a platform deployment
          these fields would be four questions with no right answer. */}
      {selfHosted && (
        <QboCredentialsForm
          secrets={secrets}
          envProvided={envProvided}
          saving={savingSecrets}
        />
      )}

      {/* Expiry warning */}
      {status && expiryWarning && (
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
            {/* /api/*, not a child of this page's path: only API-prefixed paths
                reach the Hono app (workers/app.ts allow-list). A link under
                /settings/** lands on React Router, which has no such route. */}
            <a href="/api/integrations/qbo/connect" className="underline font-semibold">
              {m.settings_qbo_reconnect_link()}
            </a>
          </span>
        </div>
      )}

      {/* Not connected */}
      {!status && <QboConnectCard />}

      {/* Connected */}
      {status && (
        <QboConnectionPanel
          status={status}
          discrepancies={discrepancies}
          busy={qboBusy}
          syncing={syncing}
          dismissingId={dismissingId}
          onSync={triggerSync}
          onTogglePause={togglePause}
          onRequestDisconnect={() => setConfirmDisconnect(true)}
          onDismissError={dismissError}
        />
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        title={m.settings_qbo_disconnect_confirm_title()}
        message={m.settings_qbo_disconnect_confirm_body()}
        confirmLabel={m.settings_qbo_disconnect_confirm_action()}
        busy={qboBusy}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}
