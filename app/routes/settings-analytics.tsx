import { useState, useEffect } from "react";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/settings-analytics";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Analytics & Metrics - Settings - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DefectRow {
  name: string;
  count: number;
}

interface AnalyticsData {
  chartPlaceholder: string;
  defects: DefectRow[];
  teamCounts: {
    inspectors: number;
    specialists: number;
    apprentices: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.analytics.dashboard.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as unknown as AnalyticsData | undefined;
    return {
      chartPlaceholder: d?.chartPlaceholder ?? "No data yet",
      defects: d?.defects ?? [],
      teamCounts: d?.teamCounts ?? { inspectors: 0, specialists: 0, apprentices: 0 },
      error: null,
    };
  } catch {
    return {
      chartPlaceholder: "No data yet",
      defects: [],
      teamCounts: { inspectors: 0, specialists: 0, apprentices: 0 },
      error: "Failed to load analytics",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsAnalyticsPage() {
  const { chartPlaceholder, defects, teamCounts, error } =
    useLoaderData<typeof loader>();

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link
          to="/settings"
          className="hover:text-ih-primary transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">
          Analytics & Metrics
        </span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">
        Analytics & Metrics
      </h2>
      <p className="text-[13px] text-ih-fg-3">
        Inspection volume, recurring defects, and team growth.
      </p>

      {error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
          {error}
        </div>
      )}

      {/* Inspections per month */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-6">
        <h3 className="text-sm font-bold text-ih-fg-1 mb-1">
          Inspections per month
        </h3>
        <p className="text-xs text-ih-fg-3 mb-4">
          12-month rolling trend. Chart renders when data is available.
        </p>
        <div className="h-48 flex items-center justify-center border border-dashed border-ih-border rounded-md">
          <span className="text-xs text-ih-fg-4">
            {chartPlaceholder}
          </span>
        </div>
      </section>

      {/* Recurring defects */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-6">
        <h3 className="text-sm font-bold text-ih-fg-1 mb-1">
          Recurring defects
        </h3>
        <p className="text-xs text-ih-fg-3 mb-4">
          Most frequently flagged items across all inspections.
        </p>
        {defects.length === 0 ? (
          <div className="text-xs text-ih-fg-4 py-4 text-center">
            No defect data yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ih-border text-left">
                <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                  Item
                </th>
                <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right">
                  Occurrences
                </th>
              </tr>
            </thead>
            <tbody>
              {defects.map((d) => (
                <tr
                  key={d.name}
                  className="border-b border-ih-border"
                >
                  <td className="py-2 text-ih-fg-2">
                    {d.name}
                  </td>
                  <td className="py-2 text-right font-mono text-ih-fg-1">
                    {d.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Team growth */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-6">
        <h3 className="text-sm font-bold text-ih-fg-1 mb-1">
          Team growth
        </h3>
        <p className="text-xs text-ih-fg-3 mb-4">
          Active inspectors, specialists, and apprentices over time.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Inspectors", value: teamCounts.inspectors },
            { label: "Specialists", value: teamCounts.specialists },
            { label: "Apprentices", value: teamCounts.apprentices },
          ].map((t) => (
            <div key={t.label} className="text-center">
              <div className="text-2xl font-bold text-ih-fg-1 tabular-nums">
                {t.value}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mt-1">
                {t.label}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
