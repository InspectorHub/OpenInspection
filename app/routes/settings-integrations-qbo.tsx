import { useState, useEffect } from "react";
import { useLoaderData, useActionData, useNavigation } from "react-router";
import { Banner, PageHeader } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-integrations-qbo";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { qboApiFetch, qboCaller } from "~/lib/qbo-api.server";
import { runCredentialCheck } from "~/lib/qbo-credential-check.server";
import { runCustomerMatchIntent } from "~/lib/qbo-customer-match.server";
import { runQboSync } from "~/lib/qbo-sync.server";
import { QboSyncResult } from "~/components/settings/QboSyncResult";
import { m } from "~/paraglide/messages";
import { getCloudflareEnv } from "~/lib/load-context";
import { getDeploymentProfile } from "../../server/lib/deployment-profile";
import { QboConnectionPanel } from "~/components/settings/QboConnectionPanel";
import { QboDisconnectDialog } from "~/components/settings/QboDisconnectDialog";
import {
  QboCredentialsForm,
  qboNeedsSetup,
  qboReadyToConnect,
  type QboCredentialTriple,
} from "~/components/settings/QboCredentialsForm";
import { QboConnectCard } from "~/components/settings/QboConnectCard";
import {
  QboOAuthOutcomeBanner,
  type QboOAuthOutcome,
} from "~/components/settings/QboOAuthOutcome";
import {
  buildRegistration,
  deriveUnconnectedCredentialSource,
  qboAccessFrom,
  resolveQboEnvironment,
  type QboEnvironment,
  type QboRegistration,
} from "~/lib/qbo-settings-loader";
import type { QBOConnectionStatus, QBOCredentialSource } from "../../server/services/qbo/api-base";

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
  /**
   * Whether the API let this person in. The management routes answer 403 to
   * anyone who is not an owner or manager, and without this the page would
   * read both calls failing as "not connected" and offer a Connect button that
   * can only fail.
   */
  access: "ok" | "forbidden";
  status: QBOConnectionStatus | null;
  /** The company's own stored credentials, masked. `QBO_ENV` is not among them: see `environment`. */
  secrets: QboCredentialTriple;
  /**
   * Whether the operator supplies their own Intuit app. When one app serves
   * everyone, the credential section is not hidden from them -- it is a
   * question they are never asked. Read from the deployment profile's
   * capability, never from an APP_MODE string compare.
   */
  selfHosted: boolean;
  /**
   * Where each setting comes from, the same answer whether or not a company is
   * connected: `/status` supplies it once connected, and until then it is
   * derived from the Worker env and the stored values by the same rule.
   * Origins only -- no value leaves the server.
   */
  credentialSource: QBOCredentialSource;
  /** The environment in force, or null when none is set. Never defaulted. */
  environment: QboEnvironment | null;
  /** The three addresses to register with Intuit, or null without a public origin. */
  registration: QboRegistration | null;
  /**
   * How the OAuth handshake ended, read off the query string that
   * `api/qbo-oauth.ts` redirects back with: `?connected=1`, or `?error=<code>`.
   */
  oauth: QboOAuthOutcome;
}

export function meta() {
  return [{ title: m.settings_qbo_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<QboLoaderData> {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const caller = qboCaller(request, token);

  const [qboRes, secretsRes] = await Promise.all([
    qboApiFetch(context, caller, "/status"),
    api.secrets.secrets.$get().catch(() => null),
  ]);

  let status: QBOConnectionStatus | null = null;
  if (qboRes?.ok) {
    const body = await qboRes.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    status = (Object.keys(d).length > 0 ? d : null) as QBOConnectionStatus | null;
  }

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const stored = (secretsBody.data ?? {}) as Record<string, string>;
  const masked = {
    QBO_CLIENT_ID: stored.QBO_CLIENT_ID || "",
    QBO_CLIENT_SECRET: stored.QBO_CLIENT_SECRET || "",
    QBO_WEBHOOK_SECRET: stored.QBO_WEBHOOK_SECRET || "",
    QBO_ENV: stored.QBO_ENV || "",
  };

  const env = getCloudflareEnv(context);
  const url = new URL(request.url);
  const rawError = url.searchParams.get("error");
  const credentialSource =
    status?.credentialSource ??
    deriveUnconnectedCredentialSource(
      {
        QBO_CLIENT_ID: env.QBO_CLIENT_ID,
        QBO_CLIENT_SECRET: env.QBO_CLIENT_SECRET,
        QBO_WEBHOOK_SECRET: env.QBO_WEBHOOK_SECRET,
        QBO_ENV: env.QBO_ENV,
      },
      masked,
    );

  return {
    access: qboAccessFrom(qboRes),
    status,
    secrets: {
      QBO_CLIENT_ID: masked.QBO_CLIENT_ID,
      QBO_CLIENT_SECRET: masked.QBO_CLIENT_SECRET,
      QBO_WEBHOOK_SECRET: masked.QBO_WEBHOOK_SECRET,
    },
    selfHosted: !getDeploymentProfile(env).qboAppManaged,
    credentialSource,
    environment: resolveQboEnvironment({
      connected: status?.environment,
      envValue: env.QBO_ENV,
      // A stored value only counts when it is the one in force.
      masked: credentialSource.environment === "tenant" ? masked.QBO_ENV : "",
    }),
    registration: buildRegistration(env.APP_BASE_URL),
    oauth: {
      connected: url.searchParams.get("connected") === "1",
      // Bounded before it reaches the page: this value arrives from a
      // redirect anyone can craft, and the renderer must never be handed
      // arbitrary attacker text to echo back.
      error: rawError ? rawError.slice(0, 64) : null,
    },
  };
}

/** What a failed fetcher action says, in words about the thing the person pressed. */
function actionFailure(intent: string): string {
  switch (intent) {
    case "qbo-pause": return m.settings_qbo_action_failed_pause();
    case "qbo-disconnect": return m.settings_qbo_action_failed_disconnect();
    default: return m.settings_qbo_action_failed_dismiss();
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();
  const intent = fd.get("intent") as string | null;
  const caller = qboCaller(request, token);

  if (intent === "save-qbo-secrets") {
    // Only a value that was typed or chosen is sent. An empty field means
    // "leave it as it is" -- including QBO_ENV, which has no default to fall
    // back on and must never be written by a save that did not touch it.
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
  // rather than pasted into a path -- this builds a URL.
  if (intent === "qbo-dismiss-error") {
    const errorId = String(fd.get("errorId") ?? "");
    if (!errorId) {
      return { success: false, intent, error: m.settings_unknown_action(), syncEnabled: undefined };
    }
    const res = await qboApiFetch(
      context, caller, `/errors/${encodeURIComponent(errorId)}/dismiss`, "POST",
    );
    if (!res?.ok) return { success: false, intent, error: actionFailure(intent), syncEnabled: undefined, errorId: undefined };
    // The id travels back so the page can drop exactly the row the server
    // closed, rather than re-deriving it from client state.
    return { success: true, intent, error: null, syncEnabled: undefined, errorId };
  }

  const match = await runCustomerMatchIntent(context, caller, intent, fd);
  if (match) return match;

  // Tests the credentials the server already holds. No body goes out and none
  // comes back: the result is a small closed set, drawn by the credentials form.
  if (intent === "qbo-check-credentials") {
    const check = await runCredentialCheck(context, caller);
    const answered = check.kind === "paired" || check.kind === "rejected" || check.kind === "unreachable";
    return { success: answered, intent, error: null, syncEnabled: undefined, check };
  }

  if (intent === "qbo-sync") return runQboSync(context, caller);

  if (intent === "qbo-pause" || intent === "qbo-disconnect") {
    const path = intent === "qbo-pause" ? "/pause" : "/disconnect";
    const res = await qboApiFetch(context, caller, path, "POST");
    if (!res?.ok) return { success: false, intent, error: actionFailure(intent), syncEnabled: undefined };

    if (intent === "qbo-pause") {
      const body = await res.json() as { data?: { syncEnabled?: boolean } };
      return { success: true, intent, error: null, syncEnabled: body?.data?.syncEnabled };
    }
    return { success: true, intent, error: null, syncEnabled: undefined };
  }

  return { success: false, intent, error: m.settings_unknown_action(), syncEnabled: undefined };
}

export default function SettingsIntegrationsQbo() {
  const {
    access, status: initial, secrets, selfHosted, credentialSource, environment, registration, oauth,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [status, setStatus] = useState<QBOConnectionStatus | null>(initial);
  // The loader revalidates after every fetcher action; take its answer so the
  // last-sync line and the counts move on after a sync instead of waiting for a reload.
  useEffect(() => setStatus(initial), [initial]);

  const savingSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-qbo-secrets";

  // Transient success flash -- visible for 4s after a save round-trip.
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
      /** Set only by `qbo-dismiss-error` -- which row the server closed. */
      errorId?: string;
      /** Set only by a finished `qbo-sync`. */
      sync?: { processed: number; checkedAt: number };
    }>();

  const syncing = qboBusy && qboFetcher.formData?.get("intent") === "qbo-sync";

  useEffect(() => {
    const d = qboFetcher.data;
    if (!d?.success) return;
    if (d.intent === "qbo-pause") {
      // Only when the action reported the new state. A pause whose response
      // omitted it leaves the switch showing what we last knew, rather than
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

  // Disconnect asks first. One click used to end the connection AND delete every
  // entity mapping -- reconnecting does not restore them, so previously-synced
  // records can be pushed again as new ones. A custom dialog rather than
  // `window.confirm`, which this codebase does not use.
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  function disconnect() {
    setConfirmDisconnect(false);
    submitQbo({ intent: "qbo-disconnect" }, { method: "POST" });
  }

  // Which row is being closed, so only its own button reads as busy. Cleared on
  // the fetcher settling -- including a FAILED dismiss, or the row would sit
  // disabled forever with no way to retry it.
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  useEffect(() => {
    if (qboFetcher.state === "idle") setDismissingId(null);
  }, [qboFetcher.state]);

  const [credentialsOpen, setCredentialsOpen] = useState(() => qboNeedsSetup(credentialSource, environment));
  const fetcherError = qboFetcher.data && !qboFetcher.data.success ? qboFetcher.data.error : null;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb
        items={[
          { label: m.settings_crumb_root(), href: "/settings" },
          { label: m.settings_integrations_crumb(), href: "/settings/integrations" },
          { label: m.settings_qbo_crumb() },
        ]}
      />
      <PageHeader title={m.settings_qbo_page_title()} meta={m.settings_qbo_page_subtitle()} />

      {access === "forbidden" ? (
        <Banner tone="warn">{m.settings_qbo_forbidden()}</Banner>
      ) : (
        <>
          {flashVisible && actionData?.success && <Banner tone="success">{m.settings_qbo_flash_saved()}</Banner>}
          {actionData?.error && <Banner tone="danger">{actionData.error}</Banner>}
          {/* A failed sync, switch, dismiss or disconnect comes back on the fetcher,
              not on the route's action data, and used to be shown nowhere. */}
          {fetcherError && <Banner tone="danger">{fetcherError}</Banner>}
          <QboSyncResult data={qboFetcher.data} />

          <QboOAuthOutcomeBanner outcome={oauth} />

          {status ? (
            <QboConnectionPanel
              status={status}
              busy={qboBusy}
              syncing={syncing}
              dismissingId={dismissingId}
              onSync={() => submitQbo({ intent: "qbo-sync" }, { method: "POST" })}
              onToggleAuto={() => submitQbo({ intent: "qbo-pause" }, { method: "POST" })}
              onRequestDisconnect={() => setConfirmDisconnect(true)}
              onDismissError={(errorId) => {
                setDismissingId(errorId);
                submitQbo({ intent: "qbo-dismiss-error", errorId }, { method: "POST" });
              }}
            />
          ) : (
            <QboConnectCard
              ready={!selfHosted || qboReadyToConnect(credentialSource, environment)}
              onNeedCredentials={() => setCredentialsOpen(true)}
            />
          )}

          {/* Only where the operator owns the Intuit app. */}
          {selfHosted && (
            <QboCredentialsForm
              secrets={secrets}
              credentialSource={credentialSource}
              environment={environment}
              registration={registration}
              saving={savingSecrets}
              open={credentialsOpen}
              onOpenChange={setCredentialsOpen}
            />
          )}

          {status && (
            <QboDisconnectDialog
              open={confirmDisconnect}
              companyName={status.companyName}
              mappedCustomers={status.mappedCustomers}
              mappedInvoices={status.mappedInvoices}
              busy={qboBusy}
              onConfirm={disconnect}
              onCancel={() => setConfirmDisconnect(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
