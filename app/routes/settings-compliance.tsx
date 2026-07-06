import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-compliance";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Table, Pill, type PillTone } from "@core/shared-ui";

const DEFAULT_RETENTION_YEARS = 6;
const MIN_RETENTION_YEARS = 1;
const MAX_RETENTION_YEARS = 99;

interface ErasureDecision {
  table: string;
  action: string;
  count: number;
  legalBasis?: string;
}

interface ErasureLogRow {
  id: string;
  subjectEmail: string;
  status: string;
  retainedCount: number;
  anonymizedCount: number;
  deletedCount: number;
  decisions: ErasureDecision[];
  createdAt: number;
}

export function meta() {
  return [{ title: "Compliance - Settings - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });

  const [configRes, logRes] = await Promise.all([
    api.admin["tenant-config"].$get().catch(() => null),
    api.admin.compliance["erasure-log"].$get().catch(() => null),
  ]);

  let retentionYears = DEFAULT_RETENTION_YEARS;
  if (configRes?.ok) {
    const body = (await configRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    const raw = Number(d.agreementRetentionYears);
    if (Number.isInteger(raw) && raw >= MIN_RETENTION_YEARS && raw <= MAX_RETENTION_YEARS) {
      retentionYears = raw;
    }
  }

  let erasureLog: ErasureLogRow[] = [];
  if (logRes?.ok) {
    const body = (await logRes.json()) as Record<string, unknown>;
    erasureLog = ((body.data ?? []) as ErasureLogRow[]);
  }

  return { retentionYears, erasureLog };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "retention-save") {
    const raw = String(form.get("retentionYears") ?? "");
    const years = Number(raw);
    // Defense in depth — the API re-validates, but reject obviously bad input
    // here so we never send a malformed PATCH.
    if (
      raw.trim() === "" ||
      !Number.isInteger(years) ||
      years < MIN_RETENTION_YEARS ||
      years > MAX_RETENTION_YEARS
    ) {
      return {
        ok: false,
        intent,
        message: `Enter a whole number between ${MIN_RETENTION_YEARS} and ${MAX_RETENTION_YEARS}.`,
      };
    }
    const res = await api.admin["tenant-config"].$patch({
      json: { agreementRetentionYears: years },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
        | string
        | undefined;
      return { ok: false, intent, message };
    }
    return { ok: true, intent };
  }

  return { ok: false, intent };
}

export default function SettingsCompliancePage() {
  const data = useLoaderData<typeof loader>();
  if ("forbidden" in data) return <AccessDenied />;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: "Settings", href: "/settings" }, { label: "Compliance" }]} />
      <p className="text-[13px] text-ih-fg-3">
        GDPR retention policy and the record of erasure requests you have honored.
      </p>

      <RetentionWindow initialYears={data.retentionYears} />
      <ErasureLogView rows={data.erasureLog} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Retention window                                                  */
/* ------------------------------------------------------------------ */

function RetentionWindow({ initialYears }: { initialYears: number }) {
  const fetcher = useFetcher<typeof action>();
  const [years, setYears] = useState(String(initialYears));
  const [dirty, setDirty] = useState(false);

  const saving = fetcher.state !== "idle";
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "retention-save" &&
    fetcher.data.ok === true &&
    !dirty;
  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "retention-save" &&
    fetcher.data.ok === false &&
    !dirty;

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      { intent: "retention-save", retentionYears: years },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          Agreement retention window
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          How long signed agreements and signatures are kept before they are permanently
          destroyed.
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="block">
          <span className="block text-[12px] font-bold text-ih-fg-2 mb-1">Years</span>
          <input
            type="number"
            min={MIN_RETENTION_YEARS}
            max={MAX_RETENTION_YEARS}
            step={1}
            value={years}
            onChange={(e) => {
              setYears(e.target.value);
              setDirty(true);
            }}
            className="w-28 px-3 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          />
        </label>
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">Saved.</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? "Save failed. Please try again."}
          </span>
        )}
      </div>

      <p className="text-[12px] text-ih-fg-3 leading-relaxed">
        Retained as a legal obligation under GDPR Art. 17(3)(e) (defence of legal claims). The
        default of 6 years matches the UK simple-contract limitation period. Note: deleted rows
        remain restorable from D1 Time-Travel backups for up to 30 days.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Erasure log (read-only accountability record)                     */
/* ------------------------------------------------------------------ */

function ErasureLogView({ rows }: { rows: ErasureLogRow[] }) {
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          Recent erasure requests
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          The accountability record of data-subject erasure requests you have honored. Read-only.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-ih-fg-4 italic">No erasure requests have been recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table<ErasureLogRow>
            rows={rows}
            getRowKey={(r) => r.id}
            columns={[
              { label: "Subject", cell: (r) => <span className="font-medium text-ih-fg-1">{r.subjectEmail}</span> },
              { label: "Date", cell: (r) => <span className="text-ih-fg-2 whitespace-nowrap">{formatDate(r.createdAt)}</span> },
              { label: "Status", cell: (r) => <StatusBadge status={r.status} /> },
              { label: "Deleted", align: "right", cell: (r) => <span className="text-ih-fg-2 tabular-nums">{r.deletedCount}</span> },
              { label: "Anonymized", align: "right", cell: (r) => <span className="text-ih-fg-2 tabular-nums">{r.anonymizedCount}</span> },
              { label: "Retained", align: "right", cell: (r) => <span className="text-ih-fg-2 tabular-nums">{r.retainedCount}</span> },
            ]}
          />
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, PillTone> = {
    completed: "sat",
    partially_completed: "warning",
    refused: "defect",
  };
  const label: Record<string, string> = {
    completed: "Completed",
    partially_completed: "Partial",
    refused: "Refused",
  };
  return (
    <Pill tone={tone[status] ?? "neutral"} className="uppercase tracking-wide">
      {label[status] ?? status}
    </Pill>
  );
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}
