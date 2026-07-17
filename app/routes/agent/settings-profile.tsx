import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/settings-profile";
import { PageHeader } from "@core/shared-ui";
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
}

export async function loader({ request, context }: Route.LoaderArgs) {
  // TODO(B-?): no GET /api/agent/profile server route — server/api/agent.ts only has
  // POST /profile. Return safe defaults until a GET route is added.
  void request;
  void context;
  return {
    agent: {
      name: null, email: "", slug: null,
      notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
    } as AgentProfile,
  };
}

export default function AgentSettingsProfilePage() {
  const { agent } = useLoaderData<typeof loader>();
  const [slug, setSlug] = useState(agent.slug || "");

  const previewLink = slug
    ? `https://*.inspectorhub.io/book/<slug>?ref=${slug}`
    : null;

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
        <div className="flex gap-2">
          <input
            id="agentSlug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={m.agent_portal_settings_slug_placeholder()}
            className="flex-1 h-9 px-3 rounded-md border border-ih-border focus:border-ih-primary focus:ring-1 focus:ring-ih-primary/30 outline-none text-[13px] font-medium placeholder:text-ih-fg-4 transition-all"
          />
          <button className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors uppercase tracking-wide">
            {m.agent_portal_settings_slug_save()}
          </button>
        </div>
        <p className="text-[12px] text-ih-fg-4 mt-2">
          {m.agent_portal_settings_slug_hint()}
        </p>
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
        <div className="divide-y divide-ih-border">
          <ToggleRow
            title={m.agent_portal_settings_notify_referral_title()}
            subtitle={m.agent_portal_settings_notify_referral_subtitle()}
            defaultOn={agent.notifyOnReferral}
          />
          <ToggleRow
            title={m.agent_portal_settings_notify_report_title()}
            subtitle={m.agent_portal_settings_notify_report_subtitle()}
            defaultOn={agent.notifyOnReport}
          />
          <ToggleRow
            title={m.agent_portal_settings_notify_paid_title()}
            subtitle={m.agent_portal_settings_notify_paid_subtitle()}
            defaultOn={agent.notifyOnPaid}
          />
        </div>
      </section>
    </div>
  );
}

function ToggleRow({ title, subtitle, defaultOn }: { title: string; subtitle: string; defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-ih-fg-1">{title}</p>
        <p className="text-[12px] text-ih-fg-3 mt-0.5">{subtitle}</p>
      </div>
      <button
        onClick={() => setOn(!on)}
        role="switch"
        aria-checked={on}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
          on ? "bg-ih-ok" : "bg-ih-bg-muted"
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-ih-bg-card transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`} />
      </button>
    </div>
  );
}
