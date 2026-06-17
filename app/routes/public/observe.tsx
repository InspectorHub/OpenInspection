import { useLoaderData } from "react-router";
import type { Route } from "./+types/observe";
import { createApi } from "~/lib/api-client.server";
import { ProgressView } from "~/components/portal/sections/ProgressView";

export function meta() {
  return [{ title: "Observe Inspection - OpenInspection" }];
}

interface ObserveData {
  address: string;
  date: string | null;
  inspectorName: string;
  status: string;
  sections: { name: string; completedItems: number; totalItems: number }[];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  try {
    const api = createApi(context);
    const token = new URL(request.url).searchParams.get("token") ?? undefined;
    const res = await api.publicReport.observe.inspections[":id"].$get({
      param: { id: params.id ?? "" },
      query: { token },
    });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      inspection: (Object.keys(d).length > 0 ? d : null) as ObserveData | null,
      error: res.ok ? null : "Inspection not found",
    };
  } catch {
    return { inspection: null, error: "Service unavailable" };
  }
}

export default function ObservePage() {
  const { inspection, error } = useLoaderData<typeof loader>();

  // The wrapper supplies the standalone page container; ProgressView stays bare.
  return (
    <div className="max-w-2xl mx-auto p-6">
      <ProgressView
        address={inspection?.address ?? ""}
        date={inspection?.date ?? null}
        inspectorName={inspection?.inspectorName ?? ""}
        status={inspection?.status ?? ""}
        sections={inspection?.sections ?? []}
        error={error || (!inspection ? "Inspection not found" : null)}
      />
    </div>
  );
}
