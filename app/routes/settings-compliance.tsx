import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-compliance";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Table, Pill, type PillTone } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

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
  return [{ title: m.settings_compliance_meta_title() }];
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
        message: m.settings_compliance_retention_range_error({ min: MIN_RETENTION_YEARS, max: MAX_RETENTION_YEARS }),
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
      <SettingsCrumb items={[{ label: m.settings_crumb_root(), href: "/settings" }, { label: m.settings_compliance_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_compliance_intro()}
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
          {m.settings_compliance_retention_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          {m.settings_compliance_retention_desc()}
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="block">
          <span className="block text-[12px] font-bold text-ih-fg-2 mb-1">{m.settings_compliance_years_label()}</span>
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
          {saving ? m.settings_compliance_saving() : m.common_save()}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">{m.settings_flash_saved_short()}</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? m.settings_compliance_save_failed()}
          </span>
        )}
      </div>

      <p className="text-[12px] text-ih-fg-3 leading-relaxed">
        {m.settings_compliance_retention_note()}
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
          {m.settings_compliance_erasure_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          {m.settings_compliance_erasure_desc()}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-ih-fg-4 italic">{m.settings_compliance_erasure_empty()}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table<ErasureLogRow>
            rows={rows}
            getRowKey={(r) => r.id}
            columns={[
              { label: m.settings_compliance_col_subject(), cell: (r) => <span className="font-medium text-ih-fg-1">{r.subjectEmail}</span> },
              { label: m.settings_compliance_col_date(), cell: (r) => <span className="text-ih-fg-2 whitespace-nowrap">{formatDate(r.createdAt)}</span> },
              { label: m.settings_compliance_col_status(), cell: (r) => <StatusBadge status={r.status} /> },
              { label: m.settings_compliance_col_deleted(), align: "right", cell: (r) => <span className="text-ih-fg-2 tabular-nums">{r.deletedCount}</span> },
              { label: m.settings_compliance_col_anonymized(), align: "right", cell: (r) => <span className="text-ih-fg-2 tabular-nums">{r.anonymizedCount}</span> },
              { label: m.settings_compliance_col_retained(), align: "right", cell: (r) => <span className="text-ih-fg-2 tabular-nums">{r.retainedCount}</span> },
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
    completed: m.settings_compliance_status_completed(),
    partially_completed: m.settings_compliance_status_partial(),
    refused: m.settings_compliance_status_refused(),
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
