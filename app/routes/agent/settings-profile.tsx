import { useState } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/settings-profile";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { toActionResult } from "~/lib/inspector-portal-actions";
import { PageHeader, Input, Button, Select, Checkbox } from "@core/shared-ui";
import { BrowserTimezoneHint } from "~/components/settings/BrowserTimezoneHint";
import {
  NotificationPreferences,
  type AlwaysSentItem,
  type ChannelId,
  type ChoiceRow,
} from "~/components/notifications/NotificationPreferences";
import { TIMEZONE_SELECT_OPTIONS } from "~/lib/timezones";
import { SmsConsentBlock, type SmsConsent } from "~/components/notifications/SmsConsentBlock";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { useNotificationSaveToast } from "~/hooks/useNotificationSaveToast";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.agent_portal_settings_meta_title() }];
}

interface AgentProfile {
  name: string | null;
  email: string;
  slug: string | null;
  /** Personal display-timezone override (IANA id), or null to follow each
   *  inspecting company's timezone. */
  timezone: string | null;
}

const DEFAULT_PROFILE: AgentProfile = { name: null, email: "", slug: null, timezone: null };

interface Company { id: string; name: string; }

interface NotificationScreen {
  companies: Company[];
  selected: string | null;
  alwaysSent: AlwaysSentItem[];
  youChoose: ChoiceRow[];
  /** The read failed. NOT the same as "no company has added you yet" — one is
   *  a broken page, the other is an invitation to wait. */
  error: string | null;
  /** Consent is per COMPANY too — it attaches to that company's contact row. */
  smsConsent: SmsConsent | null;
}

const FAILED_SCREEN = (): NotificationScreen => ({
  companies: [], selected: null, alwaysSent: [], youChoose: [], smsConsent: null,
  error: m.settings_notifications_unavailable(),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? undefined;

  const profile = await (async () => {
    try {
      const res = await api.agent.profile.$get();
      const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
      const d = (body.data ?? {}) as Partial<AgentProfile>;
      return {
        name: d.name ?? null, email: d.email ?? "",
        slug: d.slug ?? null, timezone: d.timezone ?? null,
      } as AgentProfile;
    } catch {
      return DEFAULT_PROFILE;
    }
  })();

  // The notifications card is a separate read because it is a separate
  // subject: profile fields belong to the global agent ACCOUNT, notification
  // preferences belong to the agent's relationship with ONE company. A single
  // payload would have implied they change together.
  const notifications = await (async () => {
    try {
      const res = await api.agentNotificationPrefs["notification-preferences"].$get({
        query: companyId ? { companyId } : {},
      });
      if (!res.ok) return FAILED_SCREEN();
      const body = (await res.json()) as { data?: Omit<NotificationScreen, "error"> };
      return body.data ? { ...body.data, error: null } : FAILED_SCREEN();
    } catch {
      return FAILED_SCREEN();
    }
  })();

  return { agent: profile, notifications };
}

type ActionIntent = "save-slug" | "save-notifications" | "bulk-notifications" | "save-timezone";

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const fd = await request.formData();
  const intent = fd.get("intent") as ActionIntent | null;

  if (intent === "save-slug") {
    const slug = String(fd.get("slug") || "").trim();
    const res = await api.agent.profile.$post({ json: { slug } });
    return toActionResult(res, "save-slug" as const, m.agent_portal_settings_slug_error_generic());
  }

  if (intent === "save-notifications") {
    const scope = fd.get("scope") === "all" ? ("all" as const) : ("company" as const);
    const res = await api.agentNotificationPrefs["notification-preferences"].$put({
      json: {
        classId: String(fd.get("classId") ?? ""),
        channel: String(fd.get("channel") ?? "email") as ChannelId,
        enabled: fd.get("enabled") === "true",
        scope,
        ...(scope === "company" ? { companyId: String(fd.get("companyId") ?? "") } : {}),
      },
    });
    return toActionResult(res, "save-notifications" as const, m.agent_portal_settings_notify_error_generic());
  }

  if (intent === "bulk-notifications") {
    const scope = fd.get("scope") === "all" ? ("all" as const) : ("company" as const);
    const channel = String(fd.get("channel") ?? "");
    const classId = String(fd.get("classId") ?? "");
    const res = await api.agentNotificationPrefs["notification-preferences"].bulk.$put({
      json: {
        action: String(fd.get("action") ?? "enable") as "enable" | "disable" | "reset",
        ...(channel ? { channel: channel as ChannelId } : {}),
        ...(classId ? { classId } : {}),
        scope,
        ...(scope === "company" ? { companyId: String(fd.get("companyId") ?? "") } : {}),
      },
    });
    return toActionResult(res, "bulk-notifications" as const, m.agent_portal_settings_notify_error_generic());
  }

  if (intent === "save-timezone") {
    // Empty string clears the override (server persists NULL → per-company tz).
    const timezone = String(fd.get("timezone") ?? "");
    const res = await api.agent.profile.$post({ json: { timezone } });
    return toActionResult(res, "save-timezone" as const, m.agent_portal_settings_timezone_error_generic());
  }

  return { ok: false as const, intent: "save-slug" as const, error: m.agent_portal_settings_slug_error_generic() };
}

export default function AgentSettingsProfilePage() {
  const { agent, notifications } = useLoaderData<typeof loader>();
  const [slug, setSlug] = useState(agent.slug || "");
  const slugFetcher = useFetcher<typeof action>();
  const slugSaving = slugFetcher.state !== "idle";
  const slugResult = slugFetcher.data?.intent === "save-slug" ? slugFetcher.data : null;
  const slugError = slugResult && !slugResult.ok ? slugResult.error : null;

  const notifyFetcher = useFetcher<typeof action>();
  const notifyResult = notifyFetcher.data?.intent === "save-notifications"
    || notifyFetcher.data?.intent === "bulk-notifications" ? notifyFetcher.data : null;
  const notifyError = notifyResult && !notifyResult.ok ? notifyResult.error : null;
  useNotificationSaveToast({ data: notifyResult, failed: !!notifyError, error: notifyError });
  const [applyAll, setApplyAll] = useState(false);
  // "saved" persists after the fetcher goes idle, so the confirmation is still
  // on screen when the reader looks up from the switch they just moved.
  const notifyStatus = notifyFetcher.state !== "idle" ? "saving" as const : "idle" as const;
  const navigate = useNavigate();
  const locale = useDisplayLocale();

  const tzFetcher = useFetcher<typeof action>();
  const tzResult = tzFetcher.data?.intent === "save-timezone" ? tzFetcher.data : null;
  const tzError = tzResult && !tzResult.ok ? tzResult.error : null;
  const tzSaved = tzResult?.ok === true;
  const [tz, setTz] = useState(agent.timezone ?? "");

  function saveTimezone(next: string) {
    setTz(next);
    tzFetcher.submit({ intent: "save-timezone", timezone: next }, { method: "post" });
  }

  const previewLink = slug
    ? `https://*.inspectorhub.io/book/<slug>?ref=${slug}`
    : null;

  function saveSlug() {
    slugFetcher.submit({ intent: "save-slug", slug }, { method: "post" });
  }

  function saveNotification(classId: string, channel: ChannelId, enabled: boolean) {
    notifyFetcher.submit(
      {
        intent: "save-notifications",
        classId,
        channel,
        enabled: String(enabled),
        scope: applyAll ? "all" : "company",
        companyId: notifications.selected ?? "",
      },
      { method: "post" },
    );
  }

  function bulkNotification(enabled: boolean, scope: { channel?: ChannelId; classId?: string }) {
    notifyFetcher.submit(
      {
        intent: "bulk-notifications",
        action: enabled ? "enable" : "disable",
        ...(scope.channel ? { channel: scope.channel } : {}),
        ...(scope.classId ? { classId: scope.classId } : {}),
        scope: applyAll ? "all" : "company",
        companyId: notifications.selected ?? "",
      },
      { method: "post" },
    );
  }

  function selectCompany(id: string) {
    // A full navigation, not local state: the whole card is that company's
    // answer, and the URL is what makes a reader's place in it shareable and
    // survivable across a reload.
    navigate(id ? `?company=${encodeURIComponent(id)}` : "?", { replace: true });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={m.agent_portal_settings_title()} meta={m.agent_portal_settings_subtitle()} />

      {/* Slug card */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{m.agent_portal_settings_slug_eyebrow()}</p>
        <h2 className="text-sm font-bold text-ih-fg-1 mb-1">{m.agent_portal_settings_slug_heading()}</h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">
          {m.agent_portal_settings_slug_desc()}
        </p>

        <label htmlFor="agentSlug" className="block text-[12px] font-semibold text-ih-fg-3 mb-1.5">{m.agent_portal_settings_slug_label()}</label>
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <Input
              id="agentSlug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={m.agent_portal_settings_slug_placeholder()}
              error={slugError ?? undefined}
            />
          </div>
          <Button variant="primary" onClick={saveSlug} disabled={slugSaving}>
            {m.agent_portal_settings_slug_save()}
          </Button>
        </div>
        {!slugError && (
          <p className="text-[12px] text-ih-fg-4 mt-2">
            {m.agent_portal_settings_slug_hint()}
          </p>
        )}
        {previewLink && (
          <div className="mt-3 bg-ih-bg-app/40 rounded-md px-3 py-2 text-[12px] font-mono text-ih-fg-3 break-all">
            {previewLink}
          </div>
        )}
      </section>

      {/* Notifications — per company, because the relationships are separate. */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{m.agent_portal_settings_notifications_eyebrow()}</p>
        <h2 className="text-sm font-bold text-ih-fg-1 mb-1">{m.agent_portal_settings_notifications_heading()}</h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">
          {m.agent_portal_settings_notifications_desc()}
        </p>

        {notifications.error ? (
          <p className="text-[13px] text-ih-bad-fg">{notifications.error}</p>
        ) : notifications.companies.length === 0 ? (
          <p className="text-[13px] text-ih-fg-3">{m.agent_portal_settings_notify_no_companies()}</p>
        ) : (
          <>
            <Select
              label={m.agent_portal_settings_notify_company_label()}
              value={notifications.selected ?? ""}
              onChange={(e) => selectCompany(e.target.value)}
              disabled={notifyFetcher.state !== "idle"}
              options={notifications.companies.map((co) => ({ value: co.id, label: co.name }))}
            />
            {notifications.companies.length > 1 && (
              // Only offered when there is more than one company — otherwise
              // "all" and "this one" are the same act, and the checkbox would
              // be asking a question with one answer.
              <label className="flex items-center gap-2 mt-3 text-[13px] text-ih-fg-2">
                <Checkbox
                  bare
                  checked={applyAll}
                  onChange={(e) => setApplyAll(e.currentTarget.checked)}
                />
                {m.agent_portal_settings_notify_apply_all({ count: notifications.companies.length })}
              </label>
            )}
            <div className="mt-5">
              <NotificationPreferences
                alwaysSent={notifications.alwaysSent}
                youChoose={notifications.youChoose}
                onChange={saveNotification}
                busy={notifyFetcher.state !== "idle"}
                status={notifyStatus}
                onBulk={bulkNotification}
              />
            </div>
            {notifications.smsConsent && (
              <div className="mt-5">
                <SmsConsentBlock
                  consent={notifications.smsConsent}
                  locale={locale}
                  onStop={() => bulkNotification(false, { channel: "sms" })}
                  busy={notifyFetcher.state !== "idle"}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* Timezone */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{m.agent_portal_settings_timezone_eyebrow()}</p>
        <h2 className="text-sm font-bold text-ih-fg-1 mb-1">{m.agent_portal_settings_timezone_heading()}</h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">
          {m.agent_portal_settings_timezone_desc()}
        </p>
        <Select
          label={m.agent_portal_settings_timezone_label()}
          value={tz}
          onChange={(e) => saveTimezone(e.target.value)}
          disabled={tzFetcher.state !== "idle"}
          options={[
            { value: "", label: m.agent_portal_settings_timezone_company_option() },
            ...TIMEZONE_SELECT_OPTIONS,
          ]}
        />
        <p className={`text-[12px] mt-2 ${tzError ? "text-ih-bad-fg" : "text-ih-fg-4"}`}>
          {tzError ?? (tzSaved ? m.agent_portal_settings_timezone_saved() : m.agent_portal_settings_timezone_hint())}
        </p>
        <BrowserTimezoneHint effectiveValue={tz} onUse={saveTimezone} />
      </section>
    </div>
  );
}
