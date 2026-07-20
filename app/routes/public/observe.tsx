import { useLoaderData } from "react-router";
import type { Route } from "./+types/observe";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { ProgressView } from "~/components/portal/sections/ProgressView";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.portal_observe_meta_title() }];
}

interface ObserveData {
  address: string;
  date: string | null;
  inspectorName: string;
  status: string;
  sections: { name: string; completedItems: number; totalItems: number }[];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  // This standalone observer link carries no tenant slug, so brand resolution
  // degrades to the platform default (UTC) — the honest anchor when the tenant
  // timezone is unknowable here. Format the date server-side so <ProgressView>
  // receives a humanized string (never a bare ISO).
  const brand = await resolveTenantBrand(context, undefined);
  try {
    const api = createApi(context);
    const token = new URL(request.url).searchParams.get("token") ?? undefined;
    const res = await api.publicReport.observe.inspections[":id"].$get({
      param: { id: params.id ?? "" },
      query: { token },
    });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    const inspection = (Object.keys(d).length > 0 ? d : null) as ObserveData | null;
    return {
      inspection,
      date: inspection?.date
        ? formatInspectionDateTime(inspection.date, undefined, brand.defaultTimezone)
        : null,
      error: res.ok ? null : m.portal_observe_error_not_found(),
    };
  } catch {
    return { inspection: null, date: null, error: m.portal_observe_error_unavailable() };
  }
}

export default function ObservePage() {
  const { inspection, date, error } = useLoaderData<typeof loader>();

  // The wrapper supplies the standalone page container; ProgressView stays bare.
  return (
    <div className="max-w-2xl mx-auto p-6">
      <ProgressView
        address={inspection?.address ?? ""}
        date={date}
        inspectorName={inspection?.inspectorName ?? ""}
        status={inspection?.status ?? ""}
        sections={inspection?.sections ?? []}
        error={error || (!inspection ? m.portal_observe_error_not_found() : null)}
      />
    </div>
  );
}
