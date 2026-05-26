import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/settings-profile";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Agent Settings - OpenInspection" }];
}

interface AgentProfile {
  name: string | null;
  email: string;
  slug: string | null;
  notifyOnReferral: boolean;
  notifyOnReport: boolean;
  notifyOnPaid: boolean;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/agent/profile", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Record<string, unknown>;
    return {
      agent: (Object.keys(d).length > 0 ? d : {
        name: null, email: "", slug: null,
        notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
      }) as AgentProfile,
    };
  } catch {
    return {
      agent: {
        name: null, email: "", slug: null,
        notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
      } as AgentProfile,
    };
  }
}

export default function AgentSettingsProfilePage() {
  const { agent } = useLoaderData<typeof loader>();
  const [slug, setSlug] = useState(agent.slug || "");

  const previewLink = slug
    ? `https://*.inspectorhub.io/book/<slug>?ref=${slug}`
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">Settings</h1>
        <p className="text-[14px] text-ih-fg-3 mt-1">
          Your public referral slug and the emails we send you.
        </p>
      </div>

      {/* Slug card */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Referral slug</p>
        <h2 className="text-sm font-bold text-ih-fg-1 mb-1">Your referral link</h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">
          When you share a booking link with a client, this slug attributes the
          referral to you so the inspector knows where the client came from.
        </p>

        <label htmlFor="agentSlug" className="block text-[12px] font-semibold text-ih-fg-3 mb-1.5">Slug</label>
        <div className="flex gap-2">
          <input
            id="agentSlug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="jane"
            className="flex-1 h-9 px-3 rounded-md border border-ih-border dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-[13px] font-medium placeholder:text-slate-400 transition-all"
          />
          <button className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors uppercase tracking-wide">
            Save slug
          </button>
        </div>
        <p className="text-[12px] text-slate-400 mt-2">
          Lowercase letters, numbers, and hyphens (3-32 chars).
        </p>
        {previewLink && (
          <div className="mt-3 bg-ih-bg-app/40 rounded-md px-3 py-2 text-[12px] font-mono text-ih-fg-3 break-all">
            {previewLink}
          </div>
        )}
      </section>

      {/* Notifications */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Notifications</p>
        <h2 className="text-sm font-bold text-ih-fg-1 mb-1">Email me when...</h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">
          High-signal alerts default ON. Toggle off any you don't want.
        </p>
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          <ToggleRow
            title="A new referral is booked"
            subtitle="When a client books an inspection using your referral link."
            defaultOn={agent.notifyOnReferral}
          />
          <ToggleRow
            title="A report is ready to read"
            subtitle="When the inspector publishes the report for one of your referrals."
            defaultOn={agent.notifyOnReport}
          />
          <ToggleRow
            title="An invoice is paid"
            subtitle="When your client pays the inspection invoice."
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
          on ? "bg-ih-ok-bg0" : "bg-ih-bg-muted"
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`} />
      </button>
    </div>
  );
}
