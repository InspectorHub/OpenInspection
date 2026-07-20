import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/settings-profile";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { toActionResult } from "~/lib/inspection-hub-actions";
import { PageHeader, Input, Button, Select } from "@core/shared-ui";
import { BrowserTimezoneHint } from "~/components/settings/BrowserTimezoneHint";
import { TIMEZONE_SELECT_OPTIONS } from "~/lib/timezones";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.agent_portal_settings_meta_title() }];
}

interface AgentProfile {
  name: string | null;
  email: string;
  slug: string | null;
  notifyOnReferral: boolean;
  notifyOnReport: boolean;
  notifyOnPaid: boolean;
  /** Personal display-timezone override (IANA id), or null to follow each
   *  inspecting company's timezone. */
  timezone: string | null;
}

const DEFAULT_PROFILE: AgentProfile = {
  name: null, email: "", slug: null,
  notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
  timezone: null,
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.agent.profile.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Partial<AgentProfile>;
    return {
      agent: {
        name: d.name ?? null,
        email: d.email ?? "",
        slug: d.slug ?? null,
        notifyOnReferral: d.notifyOnReferral ?? true,
        notifyOnReport: d.notifyOnReport ?? true,
        notifyOnPaid: d.notifyOnPaid ?? false,
        timezone: d.timezone ?? null,
      } as AgentProfile,
    };
  } catch {
    return { agent: DEFAULT_PROFILE };
  }
}

type ActionIntent = "save-slug" | "save-notifications" | "save-timezone";

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
    const notifyOnReferral = fd.get("notifyOnReferral") === "true";
    const notifyOnReport = fd.get("notifyOnReport") === "true";
    const notifyOnPaid = fd.get("notifyOnPaid") === "true";
    const res = await api.agent.profile.$post({
      json: { notifyOnReferral, notifyOnReport, notifyOnPaid },
    });
    return toActionResult(res, "save-notifications" as const, m.agent_portal_settings_notify_error_generic());
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
  const { agent } = useLoaderData<typeof loader>();
  const [slug, setSlug] = useState(agent.slug || "");
  const slugFetcher = useFetcher<typeof action>();
  const slugSaving = slugFetcher.state !== "idle";
  const slugResult = slugFetcher.data?.intent === "save-slug" ? slugFetcher.data : null;
  const slugError = slugResult && !slugResult.ok ? slugResult.error : null;

  const [notify, setNotify] = useState({
    notifyOnReferral: agent.notifyOnReferral,
    notifyOnReport: agent.notifyOnReport,
    notifyOnPaid: agent.notifyOnPaid,
  });
  const notifyFetcher = useFetcher<typeof action>();
  const notifyResult = notifyFetcher.data?.intent === "save-notifications" ? notifyFetcher.data : null;
  const notifyError = notifyResult && !notifyResult.ok ? notifyResult.error : null;

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

  function saveNotifications(next: typeof notify) {
    setNotify(next);
    notifyFetcher.submit(
      {
        intent: "save-notifications",
        notifyOnReferral: String(next.notifyOnReferral),
        notifyOnReport: String(next.notifyOnReport),
        notifyOnPaid: String(next.notifyOnPaid),
      },
      { method: "post" },
    );
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

      {/* Notifications */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{m.agent_portal_settings_notifications_eyebrow()}</p>
        <h2 className="text-sm font-bold text-ih-fg-1 mb-1">{m.agent_portal_settings_notifications_heading()}</h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">
          {m.agent_portal_settings_notifications_desc()}
        </p>
        {notifyError && (
          <p className="text-[12px] text-ih-bad-fg mb-2">{notifyError}</p>
        )}
        <div className="divide-y divide-ih-border">
          <ToggleRow
            title={m.agent_portal_settings_notify_referral_title()}
            subtitle={m.agent_portal_settings_notify_referral_subtitle()}
            checked={notify.notifyOnReferral}
            onChange={(v) => saveNotifications({ ...notify, notifyOnReferral: v })}
          />
          <ToggleRow
            title={m.agent_portal_settings_notify_report_title()}
            subtitle={m.agent_portal_settings_notify_report_subtitle()}
            checked={notify.notifyOnReport}
            onChange={(v) => saveNotifications({ ...notify, notifyOnReport: v })}
          />
          <ToggleRow
            title={m.agent_portal_settings_notify_paid_title()}
            subtitle={m.agent_portal_settings_notify_paid_subtitle()}
            checked={notify.notifyOnPaid}
            onChange={(v) => saveNotifications({ ...notify, notifyOnPaid: v })}
          />
        </div>
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

function ToggleRow({ title, subtitle, checked, onChange }: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-ih-fg-1">{title}</p>
        <p className="text-[12px] text-ih-fg-3 mt-0.5">{subtitle}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
          checked ? "bg-ih-ok" : "bg-ih-bg-muted"
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-ih-bg-card transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`} />
      </button>
    </div>
  );
}
