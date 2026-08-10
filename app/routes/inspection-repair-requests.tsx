/**
 * `/inspections/:id/repair-requests` — the Repair Request Log (#69).
 *
 * WHERE THIS LIVES IS THE DESIGN. The industry surface this is modelled on
 * (Spectora's RRB Log) hangs off the inspection detail page, not the report
 * editor, and neither it nor ISN's equivalent notifies anybody when a list is
 * submitted: the inspector goes and looks. So the entry point is a link in the
 * hub's Report card, this page owns the reading, and nothing anywhere sends a
 * "a repair request arrived" notice. That absence is a decision, not a gap.
 *
 * READ ONLY. There is no action export on this module and no fetcher in the
 * tree below it — see <RepairRequestLogEntry> for why a reply from the
 * inspection company is a different product, not this page's missing half.
 *
 * BFF: the loader calls the in-process API with the session token. Nothing here
 * fetches from the browser (reference_core_bff_no_client_fetch).
 */
import { useLoaderData } from "react-router";
import type { Route } from "./+types/inspection-repair-requests";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { Banner, EmptyState, PageHeader } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import {
  RepairRequestLogEntry,
  type RepairRequestLogList,
} from "~/components/inspector-portal/RepairRequestLogEntry";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useDisplayTimeZone, useInspectionDateTimeFormat } from "~/hooks/useSessionContext";
import type { RepairActionTag } from "~/lib/repair-action-tag";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.inspections_repair_log_meta_title() }];
}

// ---------------------------------------------------------------------------
// Pure model — testable without a Hono context or a DOM.
// ---------------------------------------------------------------------------

interface ApiItem {
  id: string;
  sectionTitle: string;
  itemLabel: string;
  defectTitleSnapshot: string | null;
  locationSnapshot: string | null;
  categorySnapshot: string | null;
  commentSnapshot: string | null;
  note: string | null;
  requestedCreditCents: number | null;
  repairActionTag: RepairActionTag | null;
}

interface ApiList {
  id: string;
  createdByKind: "client" | "agent" | "inspector";
  createdByRef: string;
  customIntro: string | null;
  createdAt: number;
  items: ApiItem[];
}

export interface RepairLogApiData {
  propertyAddress?: string | null;
  published?: boolean;
  lists?: ApiList[];
}

export interface RepairLogViewModel {
  propertyAddress: string | null;
  published: boolean;
  lists: Array<Omit<RepairRequestLogList, "createdAtDisplay"> & { createdAt: number }>;
}

/**
 * ⚠️ `published: false` yields NO lists, whatever the payload carried.
 *
 * The server already refuses to query them on that branch, so this is the
 * second of two independent gates rather than the only one. It is here because
 * the publish rule is a rule about this SURFACE — the log is withheld until the
 * document it reports on has been delivered — and a rule the UI depends on but
 * cannot enforce is one a later refactor of the endpoint silently removes.
 */
export function repairLogViewModel(data: RepairLogApiData): RepairLogViewModel {
  const published = data.published === true;
  const lists = published
    ? (data.lists ?? []).map((list) => ({
        id: list.id,
        createdByKind: list.createdByKind,
        createdByRef: list.createdByRef,
        customIntro: list.customIntro,
        createdAt: list.createdAt,
        creditTotalCents: list.items.reduce(
          (sum, item) => sum + (item.requestedCreditCents ?? 0),
          0,
        ),
        items: list.items.map((item) => ({
          id: item.id,
          sectionTitle: item.sectionTitle,
          itemLabel: item.itemLabel,
          // The share page resolves the same two snapshots the same way: the
          // defect's own title when it has one, the item label otherwise.
          defectTitle: item.defectTitleSnapshot ?? item.itemLabel,
          location: item.locationSnapshot,
          comment: item.commentSnapshot,
          category: item.categorySnapshot ?? "recommendation",
          note: item.note,
          requestedCreditCents: item.requestedCreditCents,
          actionTag: item.repairActionTag,
        })),
      }))
    : [];
  return {
    propertyAddress: data.propertyAddress ?? null,
    published,
    lists,
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

type LoaderResult =
  | { kind: "ok"; inspectionId: string; vm: RepairLogViewModel }
  | { kind: "error"; inspectionId: string };

export async function loader({ request, params, context }: Route.LoaderArgs): Promise<LoaderResult> {
  const token = await requireToken(context, request);
  const id = params.id;
  const api = createApi(context, { token });

  try {
    const res = await api.inspections[":id"]["repair-requests"].$get({ param: { id } });
    if (!res.ok) {
      // A 404 means the inspection is not this tenant's. The hub throws a
      // Response for that; here the page is entered FROM the hub, so the only
      // way to see it is a hand-typed id — one shared error state, and no
      // branch that tells a stranger which ids exist.
      return { kind: "error", inspectionId: id };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return {
      kind: "ok",
      inspectionId: id,
      vm: repairLogViewModel((body.data ?? {}) as RepairLogApiData),
    };
  } catch {
    return { kind: "error", inspectionId: id };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InspectionRepairRequestsPage() {
  const result = useLoaderData<typeof loader>();
  const displayTz = useDisplayTimeZone();
  const fmt = useInspectionDateTimeFormat();

  const crumbs = (
    <Breadcrumb
      items={[
        { label: m.inspections_hub_breadcrumb_inspections(), href: "/inspections" },
        {
          label:
            result.kind === "ok" && result.vm.propertyAddress
              ? result.vm.propertyAddress
              : m.inspections_hub_untitled(),
          href: `/inspections/${result.inspectionId}`,
        },
        { label: m.inspections_repair_log_breadcrumb() },
      ]}
    />
  );

  if (result.kind === "error") {
    return (
      <div className="space-y-6">
        {crumbs}
        <PageHeader title={m.inspections_repair_log_title()} />
        <Banner tone="danger">
          <span className="font-bold">{m.inspections_repair_log_error_title()}</span>{" "}
          <span className="font-normal">{m.inspections_repair_log_error_body()}</span>
        </Banner>
      </div>
    );
  }

  const { vm } = result;

  return (
    <div className="space-y-6">
      {crumbs}
      <PageHeader
        title={m.inspections_repair_log_title()}
        meta={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-ih-fg-3">{m.inspections_repair_log_intro()}</span>
            {vm.published && vm.lists.length > 0 && (
              <span className="text-ih-fg-3">
                &middot;{" "}
                {vm.lists.length === 1
                  ? m.inspections_repair_log_count_one()
                  : m.inspections_repair_log_count_other({ count: vm.lists.length })}
              </span>
            )}
          </span>
        }
      />

      {!vm.published ? (
        // The publish gate, stated rather than shown as an empty page. "No
        // repair requests" would be a false answer here: none can exist yet.
        <div data-testid="repair-log-unpublished">
          <Banner tone="info">
            <span className="font-bold">{m.inspections_repair_log_unpublished_title()}</span>{" "}
            <span className="font-normal">{m.inspections_repair_log_unpublished_body()}</span>
          </Banner>
        </div>
      ) : vm.lists.length === 0 ? (
        <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-ih-card">
          <EmptyState
            title={m.inspections_repair_log_empty_title()}
            description={m.inspections_repair_log_empty_body()}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {vm.lists.map((list) => (
            <RepairRequestLogEntry
              key={list.id}
              list={{
                ...list,
                createdAtDisplay: formatInspectionDateTime(
                  new Date(list.createdAt).toISOString(),
                  undefined,
                  displayTz,
                  fmt,
                ),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
