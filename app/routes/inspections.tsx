import { useLoaderData, Link } from 'react-router';
import { requireToken } from '~/lib/session.server';
import { createApi } from '~/lib/api-client.server';
import { INSPECTION_STATUSES, INSPECTION_STATUS_LABELS } from '~/lib/status';
import { deriveInspectionPill, deriveReportPill } from '~/lib/hub-blocks';
import { PageHeader, Card, Pill, EmptyState } from '@core/shared-ui';
import { formatInspectionDateTime } from '~/lib/format-date';

export function meta() {
  return [{ title: 'Inspections - OpenInspection' }];
}

// Row type — matches what dashboard buckets return (both axes now present)
interface InspectionRow {
  id: string;
  date: string | null;
  address?: string | null;
  propertyAddress?: string | null;
  clientName: string | null;
  status: string;
  reportStatus?: string;
}

/** Group rows by inspection lifecycle status, in canonical order, non-empty only. */
export function groupByInspectionStatus<T extends { status: string }>(
  rows: T[]
): Array<{ status: string; label: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const status of INSPECTION_STATUSES) map.set(status, []);
  for (const row of rows) {
    const bucket = map.get(row.status);
    if (bucket) bucket.push(row);
    // unknown statuses are silently dropped
  }
  return Array.from(map.entries())
    .filter(([, items]) => items.length > 0)
    .map(([status, items]) => ({
      status,
      label: INSPECTION_STATUS_LABELS[status as keyof typeof INSPECTION_STATUS_LABELS] ?? status,
      items,
    }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loader({ request, context }: { request: Request; context: any }) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const res = await api.inspections.dashboard.$get().catch(() => null);
  const inspections: InspectionRow[] = [];
  if (res && res.ok) {
    const body = (await res.json() as unknown) as { data?: Record<string, unknown[]> };
    const d = body.data ?? {};
    const seen = new Set<string>();
    for (const items of Object.values(d)) {
      if (!Array.isArray(items)) continue;
      for (const i of items as InspectionRow[]) {
        if (i && i.id && !seen.has(i.id)) {
          seen.add(i.id);
          inspections.push(i);
        }
      }
    }
  }
  return { inspections };
}

export default function InspectionsPage() {
  const { inspections } = useLoaderData<typeof loader>();
  const groups = groupByInspectionStatus(inspections);

  return (
    <div className="max-w-[1080px] mx-auto pt-5 pb-[60px] px-9 space-y-[18px]">
      <PageHeader
        eyebrow="INSPECTIONS"
        eyebrowColor="indigo"
        title="All Inspections"
        meta={<>{inspections.length} total</>}
      />

      {groups.length === 0 ? (
        <Card>
          <EmptyState title="No inspections" description="No inspections yet." />
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.status} className="overflow-hidden">
              <div className="px-4 py-3 border-b border-ih-border flex items-center gap-3">
                <Pill tone={deriveInspectionPill(group.status).tone}>
                  {group.label}
                </Pill>
                <span className="text-[11px] text-ih-fg-4">{group.items.length}</span>
              </div>
              <div className="divide-y divide-ih-border">
                {group.items.map((insp) => (
                  <Link
                    key={insp.id}
                    to={`/inspections/${insp.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-ih-bg-muted transition-colors"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-ih-fg-1">
                        {insp.address || insp.propertyAddress || 'No address'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {insp.clientName && (
                          <span className="text-[11px] text-ih-fg-3">{insp.clientName}</span>
                        )}
                        {insp.date && (
                          <span className="text-[11px] text-ih-fg-3">
                            &middot; {formatInspectionDateTime(insp.date)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <Pill tone={deriveInspectionPill(insp.status).tone}>
                        {INSPECTION_STATUS_LABELS[insp.status as keyof typeof INSPECTION_STATUS_LABELS] ?? insp.status}
                      </Pill>
                      {insp.reportStatus && (
                        <Pill tone={deriveReportPill(insp.reportStatus).tone}>
                          {deriveReportPill(insp.reportStatus).label}
                        </Pill>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
