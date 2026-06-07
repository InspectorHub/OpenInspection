import { useLoaderData, Link, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/inspection-hub";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { deriveBlockStates, formatCents, type HubPayload } from "~/lib/hub-blocks";
import { getEffectivePriceCents } from "~/lib/effective-price";
import { PageHeader, Card, Pill, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Inspection - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * The full `/api/inspections/{id}/hub` payload (Issue #111). `HubPayload`
 * (from hub-blocks.ts) types the status-derivation slice; this interface
 * extends it with the descriptive fields the six cards render. Field names
 * mirror InspectionHubSchema in server/lib/validations/inspection.schema.ts.
 */
interface HubData extends HubPayload {
  inspection: HubPayload["inspection"] & {
    id: string;
    propertyAddress: string;
    clientName: string | null;
    clientEmail: string | null;
    clientPhone: string | null;
    clientContactId: string | null;
    date: string | null;
    inspectorId: string | null;
    templateId: string | null;
    price: number;
    paymentStatus: string;
    coverPhoto: string | null;
    referredByAgentId: string | null;
    sellingAgentId: string | null;
    createdAt: string | null;
  };
  tenantSlug: string;
  people: {
    inspector: { id: string; name: string | null; email: string; phone: string | null } | null;
    client: { name: string; email: string | null; phone: string | null } | null;
    buyerAgents: PeopleAgent[];
    listingAgents: PeopleAgent[];
  };
  services: Array<{ id: string; name: string; priceCents: number }>;
  agreements: Array<{ id: string; name: string }>;
}

interface PeopleAgent {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  agency: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const id = params.id;
  const api = createApi(context, { token });
  // One aggregate round trip drives the whole page (Task 1's hub endpoint).
  const res = await api.inspections[":id"].hub.$get({ param: { id } });
  // Mirror template-edit.tsx: a non-OK response goes to the ErrorBoundary with
  // an actionable status rather than rendering a blank page. res.status is typed
  // to the success code by the hono client; read the real value as a number.
  if (!res.ok) {
    throw new Response("Inspection not found", {
      status: (res.status as number) === 403 ? 403 : 404,
    });
  }
  const body = await res.json();
  const hub = ((body as Record<string, unknown>).data ?? {}) as unknown as HubData;
  return { hub };
}

/* ------------------------------------------------------------------ */
/*  Status humanization                                               */
/* ------------------------------------------------------------------ */

/** snake_case status → Title Case for the eyebrow (e.g. "in_progress" → "In Progress"). */
function humanizeStatus(status: string): string {
  return status
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const DISABLED_TITLE = "Coming soon in this release";

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function InspectionHubPage() {
  const { hub } = useLoaderData<typeof loader>();
  const { inspection, people, services, tenantSlug } = hub;
  const blocks = deriveBlockStates(hub);

  // "View report" only makes sense once the report is shipped to the client.
  const reportShipped =
    inspection.status === "delivered" || inspection.status === "published";

  const servicesTotalCents = services.reduce((sum, s) => sum + s.priceCents, 0);
  const allAgents = [...people.buyerAgents, ...people.listingAgents];

  return (
    <div className="max-w-[1080px] mx-auto pt-5 pb-[60px] px-9 space-y-[18px]">
      {/* PageHeader — status eyebrow, address title, date + inspector meta */}
      <PageHeader
        eyebrow={humanizeStatus(inspection.status)}
        eyebrowColor="indigo"
        title={inspection.propertyAddress || "Untitled inspection"}
        meta={
          <>
            {formatInspectionDateTime(inspection.date)}
            {people.inspector?.name && (
              <span> &middot; {people.inspector.name}</span>
            )}
          </>
        }
        actions={
          <>
            <Link
              to={`/inspections/${inspection.id}/edit`}
              className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600"
            >
              Open editor
            </Link>
            {reportShipped && (
              <Link
                to={`/report/${tenantSlug}/${inspection.id}`}
                className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted"
              >
                View report
              </Link>
            )}
          </>
        }
      />

      {/* Six blocks — responsive 2-col grid (1-col on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. People ------------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="People" />
          <div className="space-y-3">
            {/* Client */}
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                Client
              </p>
              {people.client ? (
                <div className="text-[13px] text-ih-fg-1">
                  <p className="font-medium">{people.client.name}</p>
                  {people.client.email && (
                    <a href={`mailto:${people.client.email}`} className="text-ih-primary hover:underline block">
                      {people.client.email}
                    </a>
                  )}
                  {people.client.phone && (
                    <a href={`tel:${people.client.phone}`} className="text-ih-primary hover:underline block">
                      {people.client.phone}
                    </a>
                  )}
                </div>
              ) : inspection.clientName ? (
                // Bare-text fallback when only the denormalized name is present.
                <p className="text-[13px] text-ih-fg-1">{inspection.clientName}</p>
              ) : (
                <p className="text-[13px] text-ih-fg-4">No client</p>
              )}
            </div>

            {/* Agents (buyer + listing) */}
            {allAgents.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                  Agents
                </p>
                <div className="space-y-2">
                  {allAgents.map((agent) => (
                    <div key={agent.id} className="text-[13px] text-ih-fg-1">
                      <p className="font-medium">
                        {agent.name}
                        {agent.agency && (
                          <span className="text-ih-fg-3 font-normal"> &middot; {agent.agency}</span>
                        )}
                      </p>
                      {agent.email && (
                        <a href={`mailto:${agent.email}`} className="text-ih-primary hover:underline block">
                          {agent.email}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inspector */}
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                Inspector
              </p>
              {people.inspector ? (
                <p className="text-[13px] text-ih-fg-1 font-medium">
                  {people.inspector.name || people.inspector.email}
                </p>
              ) : (
                <p className="text-[13px] text-ih-fg-4">Unassigned</p>
              )}
            </div>
          </div>
        </Card>

        {/* 2. Schedule ---------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Schedule" />
          <p className="text-[15px] font-medium text-ih-fg-1">
            {formatInspectionDateTime(inspection.date)}
          </p>
          <Link
            to={`/inspections/${inspection.id}/edit`}
            className="text-[12px] font-bold text-ih-primary hover:underline mt-3 inline-block"
          >
            Reschedule in editor
          </Link>
        </Card>

        {/* 3. Services ---------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Services" />
          {services.length === 0 ? (
            <EmptyState title="No services" description="No services have been added to this inspection." />
          ) : (
            <div className="divide-y divide-ih-border">
              {services.map((svc) => (
                <div key={svc.id} className="flex items-center justify-between py-2 text-[13px]">
                  <span className="text-ih-fg-1">{svc.name}</span>
                  <span className="text-ih-fg-2 font-medium tabular-nums">
                    {formatCents(svc.priceCents)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between py-2 text-[13px] font-bold">
                <span className="text-ih-fg-1">Total</span>
                <span className="text-ih-fg-1 tabular-nums">{formatCents(servicesTotalCents)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* 4. Agreement --------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Agreement" pill={blocks.agreement} />
          {hub.agreementRequests.length > 0 ? (
            <div className="divide-y divide-ih-border mb-3">
              {hub.agreementRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between py-2 text-[12px]">
                  <span className="text-ih-fg-2 truncate mr-2">{req.clientEmail}</span>
                  <span className="text-ih-fg-4 shrink-0">
                    {req.status}
                    {(req.signedAt || req.createdAt) && (
                      <> &middot; {formatInspectionDateTime(req.signedAt || req.createdAt)}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-ih-fg-3 mb-3">No agreement requests yet.</p>
          )}
          <Button variant="secondary" size="sm" disabled title={DISABLED_TITLE}>
            Send agreement
          </Button>
        </Card>

        {/* 5. Invoice ----------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Invoice" pill={blocks.invoice} />
          <p className="text-[15px] font-medium text-ih-fg-1 mb-3">
            {hub.invoice
              ? formatCents(hub.invoice.amountCents)
              : formatCents(
                  getEffectivePriceCents({
                    serviceLines: services.map((s) => ({ priceSnapshot: s.priceCents })),
                    inspectionPriceCents: inspection.price,
                  }),
                )}
          </p>
          <Button variant="secondary" size="sm" disabled title={DISABLED_TITLE}>
            Request payment
          </Button>
        </Card>

        {/* 6. Report ------------------------------------------------ */}
        <Card className="p-5">
          <BlockHeading title="Report" pill={blocks.report} />
          <p className="text-[12px] text-ih-fg-3 mb-3">
            {inspection.status === "completed" && !hub.publishReadiness.ready
              ? `${hub.publishReadiness.blockingCount} field(s) must be filled before publishing.`
              : hub.publishReadiness.ready
                ? "All required fields are complete."
                : "Report is still in progress."}
          </p>
          <Button variant="secondary" size="sm" disabled title={DISABLED_TITLE}>
            Publish report
          </Button>
        </Card>
      </div>
    </div>
  );
}

/** Shared block heading: a label plus an optional derived status pill. */
function BlockHeading({ title, pill }: { title: string; pill?: { tone: import("~/lib/hub-blocks").PillTone; label: string } }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
        {title}
      </h2>
      {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Error boundary                                                     */
/* ------------------------------------------------------------------ */

/**
 * Surfaces a missing/forbidden inspection (404/403) or an unexpected render
 * error as an actionable message with a route back, instead of a blank page.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message =
    status === 404
      ? "This inspection could not be found. It may have been deleted."
      : status === 403
        ? "You do not have permission to view this inspection."
        : "Something went wrong while opening the inspection.";

  return (
    <div className="max-w-[1080px] mx-auto pt-16 px-9 flex flex-col items-center gap-3 text-center">
      <p className="text-[15px] font-bold text-ih-fg-1">{message}</p>
      <Link
        to="/dashboard"
        className="h-9 px-4 inline-flex items-center rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
