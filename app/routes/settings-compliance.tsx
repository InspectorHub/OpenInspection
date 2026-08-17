import { useLoaderData } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-compliance";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Table, Pill, type PillTone } from "@core/shared-ui";
import { LegalDocsPanel } from "~/components/settings/LegalDocsPanel";
import { AiAssurancePanel, type AiAssuranceRow } from "~/components/settings/AiAssurancePanel";
import { RetentionWindowSection } from "~/components/settings/RetentionWindowSection";
import { getBaseUrlFromRequest, rebaseHostedLegalUrl } from "~/lib/legal-base-url";
import { m } from "~/paraglide/messages";

const DEFAULT_RETENTION_YEARS = 6;
const MIN_RETENTION_YEARS = 1;
// Zero is meaningful for report PDFs and meaningless for agreements, so the two
// windows do not share a floor: 0 here is the tenant instructing indefinite
// retention, which the platform executes.
const MIN_PDF_RETENTION_YEARS = 0;
const DEFAULT_PDF_RETENTION_YEARS = 7;
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

  // The AI ledger is read backwards from the newest end, so the page cursor
  // lives in the URL: a compliance response can then cite the exact page it was
  // produced from. A malformed value falls back to the newest page rather than
  // erroring — this is a read-only accountability view, not a form.
  const rawBefore = new URL(request.url).searchParams.get("aiBefore");
  const parsedBefore = rawBefore === null ? NaN : Number(rawBefore);
  const aiBefore = Number.isSafeInteger(parsedBefore) && parsedBefore > 0 ? parsedBefore : null;

  const [configRes, logRes, aiRes] = await Promise.all([
    api.admin["tenant-config"].$get().catch(() => null),
    api.admin.compliance["erasure-log"].$get().catch(() => null),
    api.admin.compliance["ai-assurance"]
      .$get({ query: aiBefore === null ? {} : { before: String(aiBefore) } })
      .catch(() => null),
  ]);

  let retentionYears = DEFAULT_RETENTION_YEARS;
  let pdfRetentionYears = DEFAULT_PDF_RETENTION_YEARS;
  let legal = {
    legalMode: "hosted" as "hosted" | "custom",
    customPrivacyUrl: "" as string,
    customTermsUrl: "" as string,
    privacyBody: "" as string,
    termsBody: "" as string,
    hostedPrivacyUrl: null as string | null,
    hostedTermsUrl: null as string | null,
    effectivePrivacyUrl: null as string | null,
    effectiveTermsUrl: null as string | null,
  };
  if (configRes?.ok) {
    const body = (await configRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    const raw = Number(d.agreementRetentionYears);
    if (Number.isInteger(raw) && raw >= MIN_RETENTION_YEARS && raw <= MAX_RETENTION_YEARS) {
      retentionYears = raw;
    }
    // Its own floor: 0 is a real choice here (indefinite), not an empty field.
    const rawPdf = Number(d.reportPdfRetentionYears);
    if (Number.isInteger(rawPdf) && rawPdf >= MIN_PDF_RETENTION_YEARS && rawPdf <= MAX_RETENTION_YEARS) {
      pdfRetentionYears = rawPdf;
    }
    const origin = getBaseUrlFromRequest(request);
    const legalMode = d.legalMode === "custom" ? "custom" : "hosted";
    const hostedPrivacyUrl = rebaseHostedLegalUrl(
      typeof d.hostedPrivacyUrl === "string" ? d.hostedPrivacyUrl : null,
      origin,
    );
    const hostedTermsUrl = rebaseHostedLegalUrl(
      typeof d.hostedTermsUrl === "string" ? d.hostedTermsUrl : null,
      origin,
    );
    legal = {
      legalMode,
      customPrivacyUrl: typeof d.customPrivacyUrl === "string" ? d.customPrivacyUrl : "",
      customTermsUrl: typeof d.customTermsUrl === "string" ? d.customTermsUrl : "",
      privacyBody: typeof d.privacyBody === "string" ? d.privacyBody : "",
      termsBody: typeof d.termsBody === "string" ? d.termsBody : "",
      hostedPrivacyUrl,
      hostedTermsUrl,
      // Hosted effective URLs share the same origin rewrite; custom keeps absolute.
      effectivePrivacyUrl:
        legalMode === "custom" && typeof d.effectivePrivacyUrl === "string"
          ? d.effectivePrivacyUrl
          : hostedPrivacyUrl,
      effectiveTermsUrl:
        legalMode === "custom" && typeof d.effectiveTermsUrl === "string"
          ? d.effectiveTermsUrl
          : hostedTermsUrl,
    };
  }

  let erasureLog: ErasureLogRow[] = [];
  if (logRes?.ok) {
    const body = (await logRes.json()) as Record<string, unknown>;
    erasureLog = ((body.data ?? []) as ErasureLogRow[]);
  }

  let aiAssurance = {
    calls: [] as AiAssuranceRow[],
    unresolvedReviewCount: 0,
    nextBefore: null as number | null,
    activeBefore: aiBefore,
  };
  if (aiRes?.ok) {
    const body = (await aiRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    aiAssurance = {
      calls: Array.isArray(d.calls) ? (d.calls as AiAssuranceRow[]) : [],
      unresolvedReviewCount: Number(d.unresolvedReviewCount ?? 0),
      nextBefore: typeof d.nextBefore === "number" ? d.nextBefore : null,
      activeBefore: aiBefore,
    };
  }

  return { retentionYears, pdfRetentionYears, erasureLog, legal, aiAssurance };
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

  if (intent === "pdf-retention-save") {
    const raw = String(form.get("pdfRetentionYears") ?? "");
    const years = Number(raw);
    if (
      raw.trim() === "" ||
      !Number.isInteger(years) ||
      years < MIN_PDF_RETENTION_YEARS ||
      years > MAX_RETENTION_YEARS
    ) {
      return { ok: false, intent, message: m.settings_compliance_pdf_range_error() };
    }
    const res = await api.admin["tenant-config"].$patch({
      json: { reportPdfRetentionYears: years },
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

  if (intent === "legal-save") {
    const legalMode = String(form.get("legalMode") ?? "hosted") === "custom" ? "custom" : "hosted";
    const customPrivacyUrl = String(form.get("customPrivacyUrl") ?? "").trim();
    const customTermsUrl = String(form.get("customTermsUrl") ?? "").trim();
    const privacyBody = String(form.get("privacyBody") ?? "");
    const termsBody = String(form.get("termsBody") ?? "");
    if (legalMode === "custom" && (!customPrivacyUrl || !customTermsUrl)) {
      return {
        ok: false,
        intent,
        message: m.settings_compliance_legal_custom_required(),
      };
    }
    const res = await api.admin["tenant-config"].$patch({
      json: {
        legalMode,
        customPrivacyUrl: legalMode === "custom" ? customPrivacyUrl : null,
        customTermsUrl: legalMode === "custom" ? customTermsUrl : null,
        privacyBody: privacyBody.trim() ? privacyBody : null,
        termsBody: termsBody.trim() ? termsBody : null,
      },
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

      <RetentionWindowSection
        heading={m.settings_compliance_retention_heading()}
        description={m.settings_compliance_retention_desc()}
        note={m.settings_compliance_retention_note()}
        initialYears={data.retentionYears}
        min={MIN_RETENTION_YEARS}
        max={MAX_RETENTION_YEARS}
        intent="retention-save"
        field="retentionYears"
      />
      <RetentionWindowSection
        heading={m.settings_compliance_pdf_heading()}
        description={m.settings_compliance_pdf_desc()}
        note={m.settings_compliance_pdf_note()}
        initialYears={data.pdfRetentionYears}
        min={MIN_PDF_RETENTION_YEARS}
        max={MAX_RETENTION_YEARS}
        intent="pdf-retention-save"
        field="pdfRetentionYears"
      />
      <LegalDocsPanel initial={data.legal} />
      <ErasureLogView rows={data.erasureLog} />
      <AiAssurancePanel initial={data.aiAssurance} />
    </div>
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
        <p className="text-[12px] text-ih-fg-3 italic">{m.settings_compliance_erasure_empty()}</p>
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
