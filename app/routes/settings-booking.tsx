import { Link, redirect, useLoaderData } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-booking";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { useCopyClipboard } from "~/hooks/useCopyClipboard";
import { SCHEDULING_ROLES } from "~/lib/settings/constants";
import { BookingPoliciesPanel } from "~/components/settings/BookingPoliciesPanel";
import { EmbedWidgetPanel } from "~/components/settings/EmbedWidgetPanel";

interface TenantConfig {
  conciergeReviewRequired: boolean;
  blockUnsignedAgreement: boolean;
  allowInspectorChoice: boolean;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export function meta() {
  return [{ title: "Online Booking - Settings - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  // Inspectors who bookmarked this page land on My Schedule instead of AccessDenied.
  if (forbidden) throw redirect("/settings/schedule");

  const api = createApi(context, { token });

  const [configRes, membersRes] = await Promise.all([
    api.admin["tenant-config"].$get().catch(() => null),
    api.admin.members.$get().catch(() => null),
  ]);

  let config: TenantConfig = {
    conciergeReviewRequired: false,
    blockUnsignedAgreement: false,
    allowInspectorChoice: false,
  };
  if (configRes?.ok) {
    const body = (await configRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    config = {
      conciergeReviewRequired: Boolean(d.conciergeReviewRequired),
      blockUnsignedAgreement: Boolean(d.blockUnsignedAgreement),
      allowInspectorChoice: Boolean(d.allowInspectorChoice),
    };
  }

  let members: Member[] = [];
  if (membersRes?.ok) {
    const body = (await membersRes.json()) as Record<string, unknown>;
    members = (body.data ?? []) as Member[];
  }

  return { config, members };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) throw redirect("/settings/schedule");

  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "policies-save") {
    const res = await api.admin["tenant-config"].$patch({
      json: {
        conciergeReviewRequired: form.get("conciergeReviewRequired") === "true",
        blockUnsignedAgreement: form.get("blockUnsignedAgreement") === "true",
        allowInspectorChoice: form.get("allowInspectorChoice") === "true",
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
        | string
        | undefined;
      return { ok: false, intent, message };
    }
    return { ok: res.ok, intent };
  }

  return { ok: false, intent };
}

export default function SettingsBookingPage() {
  const data = useLoaderData<typeof loader>();
  const ctx = useSessionContext();
  const tenant = ctx?.branding?.tenantSlug;

  const schedulingMembers = data.members.filter((m) =>
    (SCHEDULING_ROLES as readonly string[]).includes(m.role),
  );

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: "Settings", href: "/settings" }, { label: "Online Booking" }]} />
      <p className="text-[13px] text-ih-fg-3">
        Company booking policies and the embeddable widget.
      </p>

      <ManageTeamSchedulesBar memberCount={schedulingMembers.length} />
      <CompanyBookingLinks tenant={tenant} />
      <BookingPoliciesPanel initialConfig={data.config} />
      <EmbedWidgetPanel tenant={tenant} />
    </div>
  );
}

function ManageTeamSchedulesBar({ memberCount }: { memberCount: number }) {
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-[13px] font-bold text-ih-fg-1">Team schedules</h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          Weekly hours and time off live under My Schedule
          {memberCount > 0 ? ` (${memberCount} schedulable members)` : ""}.
        </p>
      </div>
      <Link
        to="/settings/schedule"
        className="h-9 px-4 inline-flex items-center rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors"
      >
        Manage team schedules →
      </Link>
    </section>
  );
}

function CompanyBookingLinks({ tenant }: { tenant: string | null | undefined }) {
  const { copied: copiedField, copy } = useCopyClipboard();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const companyUrl = tenant ? `${origin}/book/${tenant}` : null;

  if (!companyUrl) return null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Company link</h3>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-bold text-ih-fg-2 w-36 shrink-0">Booking page</span>
        <span className="text-[12px] text-ih-fg-1 truncate flex-1 font-mono bg-ih-bg-muted rounded px-2 py-1.5 border border-ih-border">
          {companyUrl}
        </span>
        <button
          type="button"
          onClick={() => copy(companyUrl, "company")}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
        >
          {copiedField === "company" ? "Copied!" : "Copy"}
        </button>
        <a
          href={companyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ih-fg-3 hover:text-ih-primary transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
            />
          </svg>
        </a>
      </div>
      <p className="text-[12px] text-ih-fg-3">
        Share the company link — clients are matched with the first available inspector.
      </p>
    </section>
  );
}
