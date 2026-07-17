import { useLoaderData, Link, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/contact-detail";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { formatCents } from "~/lib/hub-blocks";
import { humanizeStatus, capitalize } from "~/lib/status";
import { Breadcrumb } from "~/components/Breadcrumb";
import { PageHeader, Card, Pill, EmptyState } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.contacts_detail_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Types — mirror ContactDetailSchema in                              */
/*  server/lib/validations/contact.schema.ts                           */
/* ------------------------------------------------------------------ */

interface ContactDetail {
  contact: {
    id: string;
    type: "agent" | "client";
    name: string;
    email: string | null;
    phone: string | null;
    agency: string | null;
    notes: string | null;
    createdAt: string;
    archivedAt: string | null;
  };
  inspections: Array<{
    id: string;
    propertyAddress: string;
    date: string;
    status: string;
    price: number;
    paymentStatus: string;
  }>;
  stats: {
    inspectionCount: number;
    totalRevenueCents: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const id = params.id;
  const api = createApi(context, { token });
  // Task 10's contact-detail endpoint drives the whole page in one round trip.
  const res = await api.contacts[":id"].$get({ param: { id } });
  // Mirror inspection-hub.tsx: a non-OK response goes to the ErrorBoundary with
  // an actionable status rather than rendering a blank page.
  if (!res.ok) {
    throw new Response("Contact not found", {
      status: (res.status as number) === 403 ? 403 : 404,
    });
  }
  const body = await res.json();
  const detail = ((body as Record<string, unknown>).data ?? {}) as unknown as ContactDetail;
  return { detail };
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function ContactDetailPage() {
  const { detail } = useLoaderData<typeof loader>();
  const { contact, inspections, stats } = detail;
  const archived = !!contact.archivedAt;

  return (
    /* ds-allow: page bottom gutter (60px), bespoke page-shell spacing with no token */
    <div className="max-w-[1080px] mx-auto pt-5 pb-[60px] px-9 space-y-ih-list">
      {/* Breadcrumb — Contacts > this contact */}
      <Breadcrumb
        items={[
          { label: m.contacts_label_contacts(), href: "/contacts" },
          { label: contact.name },
        ]}
      />

      {/* PageHeader — type pill in meta, name title, agency/email meta */}
      <PageHeader
        title={contact.name}
        meta={
          <span className="flex items-center gap-2 flex-wrap">
            <Pill tone="info">{capitalize(contact.type)}</Pill>
            {archived && <Pill tone="neutral">{m.contacts_detail_archived()}</Pill>}
            <span className="text-ih-fg-3">
              {contact.type === "agent"
                ? contact.agency || contact.email || ""
                : contact.email || ""}
            </span>
          </span>
        }
        actions={
          <Link
            to="/contacts"
            className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted"
          >
            {m.contacts_detail_back()}
          </Link>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Contact info ------------------------------------------ */}
        <Card className="p-5">
          <BlockHeading title={m.contacts_detail_info_heading()} />
          <div className="space-y-3 text-[13px]">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                {m.contacts_field_email()}
              </p>
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-ih-primary hover:underline">
                  {contact.email}
                </a>
              ) : (
                <p className="text-ih-fg-4">—</p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                {m.contacts_field_phone()}
              </p>
              {contact.phone ? (
                <a href={`tel:${contact.phone}`} className="text-ih-primary hover:underline">
                  {contact.phone}
                </a>
              ) : (
                <p className="text-ih-fg-4">—</p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                {m.contacts_field_agency()}
              </p>
              <p className="text-ih-fg-1">{contact.agency || <span className="text-ih-fg-4">—</span>}</p>
            </div>

            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                {m.contacts_field_notes()}
              </p>
              {contact.notes ? (
                <p className="text-ih-fg-1 whitespace-pre-wrap">{contact.notes}</p>
              ) : (
                <p className="text-ih-fg-4">{m.contacts_detail_no_notes()}</p>
              )}
            </div>
          </div>
        </Card>

        {/* 2. Stats ------------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title={m.contacts_detail_stats_heading()} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                {m.contacts_field_inspections()}
              </p>
              <p className="text-[24px] font-bold text-ih-fg-1 tabular-nums">
                {stats.inspectionCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                {m.contacts_detail_revenue_label()}
              </p>
              <p className="text-[24px] font-bold text-ih-fg-1 tabular-nums">
                {formatCents(stats.totalRevenueCents)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* 3. Inspection history -------------------------------------- */}
      <Card className="p-5">
        <BlockHeading title={m.contacts_detail_history_heading()} />
        {inspections.length === 0 ? (
          <EmptyState
            title={m.contacts_detail_history_empty_title()}
            description={m.contacts_detail_history_empty_desc()}
          />
        ) : (
          <div className="divide-y divide-ih-border">
            {inspections.map((insp) => (
              <Link
                key={insp.id}
                to={`/inspections/${insp.id}`}
                className="flex items-center justify-between gap-4 py-3 hover:bg-ih-bg-muted/50 -mx-2 px-2 rounded-md transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ih-fg-1 truncate">
                    {insp.propertyAddress || m.contacts_detail_untitled_inspection()}
                  </p>
                  <p className="text-[12px] text-ih-fg-3">
                    {formatInspectionDateTime(insp.date)} &middot; {humanizeStatus(insp.status)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-medium text-ih-fg-1 tabular-nums">
                    {formatCents(insp.price)}
                  </p>
                  <p className="text-[12px] text-ih-fg-3">{humanizeStatus(insp.paymentStatus)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Shared block heading: an uppercase label (mirrors inspection-hub.tsx). */
function BlockHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
        {title}
      </h2>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Error boundary                                                     */
/* ------------------------------------------------------------------ */

/**
 * Surfaces a missing/forbidden contact (404/403) or an unexpected render error
 * as an actionable message with a route back, instead of a blank page.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message =
    status === 404
      ? m.contacts_error_not_found()
      : status === 403
        ? m.contacts_error_forbidden()
        : m.contacts_error_generic();

  return (
    <div className="max-w-[1080px] mx-auto pt-16 px-9 flex flex-col items-center gap-3 text-center">
      <p className="text-[15px] font-bold text-ih-fg-1">{message}</p>
      <Link
        to="/contacts"
        className="h-9 px-4 inline-flex items-center rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600"
      >
        {m.contacts_detail_back()}
      </Link>
    </div>
  );
}
