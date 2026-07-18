import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { Button, Modal, SegmentedControl } from "@core/shared-ui";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { formatDateTime } from "~/lib/format";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";

/**
 * Commercial PCA Phase M Task 10 — the "Compliance (Full PCA)" editor panel.
 * Rendered ONLY when the inspection's reportTier === 'full_pca' (see the
 * gate in inspection-edit.tsx); light_commercial and residential inspections
 * never mount this panel.
 *
 * Every mutation type gets its OWN `useFetcher` instance (signoff per role,
 * remove-signoff per role, PSQ responses, PSQ status, doc-review per item) —
 * sharing a fetcher across an unrelated in-flight mutation would abort it
 * (see feedback_rr_shared_fetcher_abort / the B-17 notes-vs-rating bug this
 * project already hit once). Every submit dispatches an `intent` to the
 * inspection-edit route action (BFF relay — never a raw client fetch to
 * /api/..., see feedback_core_bff_no_client_fetch); the action then calls the
 * Task 6 compliance API via `createApi`.
 *
 * The route POSTs skip revalidation (see inspection-edit.tsx's
 * `shouldRevalidate`), so every sub-section keeps its own local optimistic
 * copy of the server row(s) it owns rather than re-reading stale loader data
 * after a submit. Sign-off (add/remove) and the doc-review seed have no local
 * optimistic copy — they render straight off `data` (loader props) — so those
 * three call `revalidator.revalidate()` on a successful submit, mirroring the
 * units pattern in inspection-edit.tsx (~line 510). PSQ and per-row doc-review
 * keep local state and stay revalidation-free.
 */

// ── Wire-shape mirrors (hand-mirrored from server/lib/validations/compliance.schema.ts;
//    kept local/minimal — the panel only needs the fields it renders) ──────────

type SignoffRole = "field_observer" | "pcr_reviewer";

interface ReportSignoffView {
  role: SignoffRole;
  personId: string;
  name: string;
  license: string | null;
  qualificationsRef?: string | null;
  signedAt?: number;
  dualRole?: boolean;
}

interface PsqView {
  status: "sent" | "received" | "declined";
  responses: Record<string, unknown> | null;
}

interface DocumentReviewItemView {
  documentKey: string;
  label: string;
  requested: boolean;
  received: boolean;
  reviewed: boolean;
  na: boolean;
  notes: string | null;
}

interface RelianceTextView {
  userReliance: string;
  pointInTime: string;
  siteSpecific: string;
}

export interface CompliancePanelData {
  reportSignoffs: ReportSignoffView[];
  psq: PsqView | null;
  documentReview: DocumentReviewItemView[];
  conformance: { standard: "E2018-24"; conforms: boolean };
  relianceText: RelianceTextView;
}

// Thunks (not module consts) so labels resolve at render time rather than being
// frozen to the message value present at import.
function roleLabel(role: SignoffRole): string {
  return role === "field_observer"
    ? m.editor_compliance_role_field_observer()
    : m.editor_compliance_role_pcr_reviewer();
}

// Keys are stable data; labels resolve per render via psqQuestions().
const PSQ_QUESTION_KEYS = [
  "knownDeficiencies",
  "pendingViolations",
  "environmentalConcerns",
  "plannedImprovements",
] as const;

function psqQuestions(): { key: string; label: string }[] {
  return [
    { key: "knownDeficiencies", label: m.editor_compliance_psq_q_known_deficiencies() },
    { key: "pendingViolations", label: m.editor_compliance_psq_q_pending_violations() },
    { key: "environmentalConcerns", label: m.editor_compliance_psq_q_environmental() },
    { key: "plannedImprovements", label: m.editor_compliance_psq_q_improvements() },
  ];
}

function normalizeResponses(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PSQ_QUESTION_KEYS) {
    const v = raw?.[key];
    out[key] = typeof v === "string" ? v : "";
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Conformance preview (d)                                            */
/* ------------------------------------------------------------------ */

function ConformancePreview({ data }: { data: CompliancePanelData }) {
  const reviewerSigned = data.reportSignoffs.some((r) => r.role === "pcr_reviewer");
  const psqOk = data.psq?.status === "received" || data.psq?.status === "declined";
  const docReviewStarted = data.documentReview.length > 0;
  const conforms = data.conformance.conforms;

  return (
    <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3 space-y-2" data-testid="conformance-preview">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-ih-fg-2">{m.editor_compliance_conformance_heading({ standard: data.conformance.standard })}</span>
        <span className={`ih-pill ${conforms ? "ih-pill--sat" : "ih-pill--defect"}`}>
          {conforms ? m.editor_compliance_conforms() : m.editor_compliance_does_not_conform()}
        </span>
      </div>
      <ul className="text-[11px] text-ih-fg-4 space-y-0.5">
        <li>{reviewerSigned ? "✓" : "—"} {m.editor_compliance_check_pcr()}</li>
        <li>{psqOk ? "✓" : "—"} {m.editor_compliance_check_psq()}</li>
        <li>{docReviewStarted ? "✓" : "—"} {m.editor_compliance_check_doc_review()}</li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sign-off (a)                                                       */
/* ------------------------------------------------------------------ */

function SignoffRoleCard({ role, existing }: { role: SignoffRole; existing: ReportSignoffView | null }) {
  const displayTz = useDisplayTimeZone();
  const locale = useDisplayLocale();
  // Independent fetchers per role AND per mutation type — a remove on one
  // role must never abort an in-flight sign-off submit on the other.
  const signFetcher = useFetcher();
  const removeFetcher = useFetcher();
  const [personId, setPersonId] = useState(existing?.personId ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [license, setLicense] = useState(existing?.license ?? "");
  const [dualRole, setDualRole] = useState(existing?.dualRole ?? false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const saving = signFetcher.state !== "idle";
  const removing = removeFetcher.state !== "idle";

  // This card renders straight off `existing` (loader props) — no local
  // optimistic copy of "signed" state — so a successful sign-off or removal
  // must revalidate the route or the card never leaves its stale state.
  // Mirrors the units pattern in inspection-edit.tsx (~line 510): guard with
  // a last-seen ref since `fetcher.data` keeps the same reference across
  // renders and `revalidator` is a fresh object every render — without the
  // guard this effect would re-fire and revalidate on every render.
  const revalidator = useRevalidator();
  const lastRevalidatedSignData = useRef<unknown>(null);
  useEffect(() => {
    const d = signFetcher.data as { ok?: boolean } | undefined;
    if (signFetcher.state === "idle" && d?.ok && lastRevalidatedSignData.current !== d) {
      lastRevalidatedSignData.current = d;
      revalidator.revalidate();
    }
  }, [signFetcher.state, signFetcher.data, revalidator]);
  const lastRevalidatedRemoveData = useRef<unknown>(null);
  useEffect(() => {
    const d = removeFetcher.data as { ok?: boolean } | undefined;
    if (removeFetcher.state === "idle" && d?.ok && lastRevalidatedRemoveData.current !== d) {
      lastRevalidatedRemoveData.current = d;
      revalidator.revalidate();
    }
  }, [removeFetcher.state, removeFetcher.data, revalidator]);

  const submitSignoff = () => {
    if (!personId.trim() || !name.trim()) return;
    signFetcher.submit(
      {
        intent: "compliance-signoff",
        role,
        personId: personId.trim(),
        name: name.trim(),
        license: license.trim(),
        dualRole: String(dualRole),
      },
      { method: "POST" },
    );
  };

  const confirmRemove = () => {
    removeFetcher.submit({ intent: "compliance-remove-signoff", role }, { method: "POST" });
    setConfirmOpen(false);
  };

  return (
    <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3 space-y-2" data-testid={`signoff-${role}`}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-ih-fg-2">{roleLabel(role)}</span>
        <span className={`text-[11px] font-bold ${existing ? "text-ih-ok-fg" : "text-ih-fg-4"}`}>
          {existing ? m.editor_compliance_signed() : m.editor_compliance_not_signed()}
        </span>
      </div>

      {existing ? (
        <div className="text-[12px] text-ih-fg-2 space-y-1">
          <div>{existing.name}{existing.license ? m.editor_compliance_license_suffix({ license: existing.license }) : ""}</div>
          {existing.signedAt ? (
            <div className="text-[11px] text-ih-fg-4">{m.editor_compliance_signed()} {formatDateTime(existing.signedAt, { locale, timeZone: displayTz })}</div>
          ) : null}
          <Button variant="danger-link" size="sm" disabled={removing} onClick={() => setConfirmOpen(true)}>
            {removing ? m.editor_compliance_removing() : m.common_remove()}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            placeholder={m.editor_compliance_person_id()}
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            disabled={saving}
            className="ih-input w-full"
          />
          <input
            placeholder={m.editor_compliance_name()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            className="ih-input w-full"
          />
          <input
            placeholder={m.editor_compliance_license_optional()}
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            disabled={saving}
            className="ih-input w-full"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-ih-fg-3">
            <input
              type="checkbox"
              checked={dualRole}
              onChange={(e) => setDualRole(e.target.checked)}
              disabled={saving}
            />
            {m.editor_compliance_dual_role()}
          </label>
          <Button
            variant="primary"
            size="sm"
            onClick={submitSignoff}
            disabled={saving || !personId.trim() || !name.trim()}
            className="w-full"
          >
            {saving ? m.editor_compliance_signing() : m.editor_compliance_sign_off()}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={m.editor_compliance_remove_signoff_title()}
        message={m.editor_compliance_remove_signoff_msg({ role: roleLabel(role) })}
        confirmLabel={m.common_remove()}
        busy={removing}
        onConfirm={confirmRemove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PSQ (b)                                                            */
/* ------------------------------------------------------------------ */

function psqStatuses(): { value: "sent" | "received" | "declined"; label: string }[] {
  return [
    { value: "sent", label: m.editor_compliance_status_sent() },
    { value: "received", label: m.editor_compliance_received() },
    { value: "declined", label: m.editor_compliance_status_declined() },
  ];
}

function PsqPanel({ psq }: { psq: PsqView | null }) {
  // Separate fetcher per mutation TYPE (responses vs status) — a status click
  // must not abort an in-flight responses save, and vice versa.
  const responsesFetcher = useFetcher();
  const statusFetcher = useFetcher();
  const [responses, setResponses] = useState<Record<string, string>>(() => normalizeResponses(psq?.responses));
  const [status, setStatus] = useState<PsqView["status"] | null>(psq?.status ?? null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const savingResponses = responsesFetcher.state !== "idle";
  const settingStatus = statusFetcher.state !== "idle";

  const commitResponses = () => {
    responsesFetcher.submit(
      { intent: "compliance-psq", responses: JSON.stringify(responses) },
      { method: "POST" },
    );
  };

  const applyStatus = (next: "sent" | "received", reason?: string) => {
    setStatus(next);
    statusFetcher.submit(
      { intent: "compliance-psq-status", status: next, ...(reason ? { reason } : {}) },
      { method: "POST" },
    );
  };

  const confirmDecline = () => {
    setStatus("declined");
    statusFetcher.submit(
      { intent: "compliance-psq-status", status: "declined", reason: declineReason.trim() || "(no reason provided)" },
      { method: "POST" },
    );
    setDeclineOpen(false);
    setDeclineReason("");
  };

  return (
    <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3 space-y-3" data-testid="psq-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-4">{m.editor_compliance_status()}</span>
        <fieldset disabled={settingStatus} className="contents">
          <SegmentedControl
            ariaLabel={m.editor_compliance_psq_status()}
            value={status ?? ""}
            onChange={(v) => {
              const next = v as "sent" | "received" | "declined";
              if (next === "declined") setDeclineOpen(true);
              else applyStatus(next);
            }}
            options={psqStatuses().map((s) => ({ value: s.value, label: s.label }))}
          />
        </fieldset>
      </div>

      <div className="space-y-2">
        {psqQuestions().map((q) => (
          <label key={q.key} className="block">
            <span className="mb-1 block text-[11px] font-medium text-ih-fg-3">{q.label}</span>
            <textarea
              rows={2}
              value={responses[q.key] ?? ""}
              disabled={savingResponses}
              onChange={(e) => setResponses((r) => ({ ...r, [q.key]: e.target.value }))}
              onBlur={commitResponses}
              className="w-full rounded border border-ih-border bg-ih-bg-app p-2 text-[12px] text-ih-fg-1"
            />
          </label>
        ))}
      </div>

      <Modal
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title={m.editor_compliance_decline_psq_title()}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)}>
              {m.common_cancel()}
            </Button>
            <Button variant="danger" onClick={confirmDecline}>
              {m.editor_compliance_decline()}
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-1 block text-[12px] text-ih-fg-2">
            {m.editor_compliance_decline_body()}
          </span>
          <textarea
            rows={3}
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            className="w-full rounded border border-ih-border bg-ih-bg-app p-2 text-[12px] text-ih-fg-1"
            placeholder={m.editor_compliance_decline_placeholder()}
          />
        </label>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Document review checklist (c)                                     */
/* ------------------------------------------------------------------ */

function DocReviewRow({ item }: { item: DocumentReviewItemView }) {
  // One fetcher PER ROW (own component instance) — toggling one document's
  // checkbox must never abort another row's in-flight notes save.
  const fetcher = useFetcher();
  const [local, setLocal] = useState(item);
  const busy = fetcher.state !== "idle";

  const submitPatch = (next: DocumentReviewItemView) => {
    setLocal(next);
    fetcher.submit(
      {
        intent: "compliance-doc-review",
        documentKey: next.documentKey,
        requested: String(next.requested),
        received: String(next.received),
        reviewed: String(next.reviewed),
        na: String(next.na),
        notes: next.notes ?? "",
      },
      { method: "POST" },
    );
  };

  return (
    <li className="rounded border border-ih-border bg-ih-bg-card p-2.5 space-y-1.5" data-testid={`doc-review-${item.documentKey}`}>
      <div className="text-[12px] font-bold text-ih-fg-2">{local.label}</div>
      <div className="flex flex-wrap gap-3 text-[11px] text-ih-fg-3">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={local.requested}
            disabled={busy}
            onChange={(e) => submitPatch({ ...local, requested: e.target.checked })}
          />
          {m.editor_compliance_doc_requested()}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={local.received}
            disabled={busy}
            onChange={(e) => submitPatch({ ...local, received: e.target.checked })}
          />
          {m.editor_compliance_received()}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={local.reviewed}
            disabled={busy}
            onChange={(e) => submitPatch({ ...local, reviewed: e.target.checked })}
          />
          {m.editor_compliance_doc_reviewed()}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={local.na}
            disabled={busy}
            onChange={(e) => submitPatch({ ...local, na: e.target.checked })}
          />
          {m.editor_compliance_doc_na()}
        </label>
      </div>
      <textarea
        rows={2}
        placeholder={m.editor_compliance_notes()}
        value={local.notes ?? ""}
        disabled={busy}
        onChange={(e) => setLocal((l) => ({ ...l, notes: e.target.value }))}
        onBlur={() => submitPatch(local)}
        className="w-full rounded border border-ih-border bg-ih-bg-app p-1.5 text-[12px] text-ih-fg-1"
      />
    </li>
  );
}

function DocReviewSection({ items }: { items: DocumentReviewItemView[] }) {
  // Seeding the standard checklist is its own mutation type/fetcher too.
  const seedFetcher = useFetcher();
  const seeding = seedFetcher.state !== "idle";

  // Seeding creates rows server-side but this section renders `items`
  // straight from loader props — without a revalidation the checklist stays
  // empty after a successful seed. Same guarded pattern as SignoffRoleCard /
  // the units fetcher in inspection-edit.tsx.
  const revalidator = useRevalidator();
  const lastRevalidatedSeedData = useRef<unknown>(null);
  useEffect(() => {
    const d = seedFetcher.data as { ok?: boolean } | undefined;
    if (seedFetcher.state === "idle" && d?.ok && lastRevalidatedSeedData.current !== d) {
      lastRevalidatedSeedData.current = d;
      revalidator.revalidate();
    }
  }, [seedFetcher.state, seedFetcher.data, revalidator]);

  return (
    <div className="space-y-2" data-testid="doc-review-section">
      {items.length === 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-ih-fg-3">{m.editor_compliance_no_docs()}</p>
          <Button
            variant="link"
            size="sm"
            disabled={seeding}
            onClick={() => seedFetcher.submit({ intent: "compliance-doc-review-seed" }, { method: "POST" })}
          >
            {seeding ? m.common_loading() : m.editor_compliance_load_checklist()}
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <DocReviewRow key={item.documentKey} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reliance & Limitations (M10)                                       */
/* ------------------------------------------------------------------ */

function relianceFields(): { key: keyof RelianceTextView; label: string }[] {
  return [
    { key: "userReliance", label: m.editor_compliance_reliance_userReliance() },
    { key: "pointInTime", label: m.editor_compliance_reliance_pointInTime() },
    { key: "siteSpecific", label: m.editor_compliance_reliance_siteSpecific() },
  ];
}

// One fetcher PER reliance clause — the three clauses save independently, so a
// save of one must never abort another's in-flight PATCH. This is the file-wide
// own-fetcher rule (see the header comment + the B-17 notes-vs-rating bug this
// project already hit): a single fetcher shared across the three would cancel
// the first field's save the moment the second field blurs.
function RelianceFieldRow({ fieldKey, label, initial }: { fieldKey: keyof RelianceTextView; label: string; initial: string }) {
  const fetcher = useFetcher();
  const [value, setValue] = useState(initial);
  // Last value we actually persisted — lets us skip a no-op save when a field
  // is blurred without an edit (e.g. tabbing through just to read it), which
  // would otherwise write a redundant PATCH + pca_narrative.update audit entry
  // on every pass. POSTs skip revalidation, so the local copy is the optimistic
  // source of truth like PsqPanel / DocReviewRow.
  const savedRef = useRef(initial);
  const busy = fetcher.state !== "idle";

  const commit = () => {
    if (value === savedRef.current) return;
    savedRef.current = value;
    fetcher.submit({ intent: "save-pca-narrative", key: fieldKey, value }, { method: "POST" });
  };

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ih-fg-3">{label}</span>
      <textarea
        rows={2}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        className="w-full rounded border border-ih-border bg-ih-bg-app p-2 text-[12px] text-ih-fg-1"
      />
    </label>
  );
}

function RelianceSection({ relianceText }: { relianceText: RelianceTextView }) {
  return (
    <section className="space-y-1.5" data-testid="reliance-section">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4">{m.editor_compliance_reliance_heading()}</h3>
      <div className="space-y-2">
        {relianceFields().map((f) => (
          <RelianceFieldRow key={f.key} fieldKey={f.key} label={f.label} initial={relianceText[f.key]} />
        ))}
      </div>
      <p className="text-[11px] text-ih-fg-4 italic">
        {m.editor_compliance_reliance_note()}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                              */
/* ------------------------------------------------------------------ */

export function CompliancePanel({ inspectionId, data }: { inspectionId: string; data: CompliancePanelData }) {
  const fieldObserver = data.reportSignoffs.find((r) => r.role === "field_observer") ?? null;
  const pcrReviewer = data.reportSignoffs.find((r) => r.role === "pcr_reviewer") ?? null;

  return (
    <div className="space-y-5" data-testid="compliance-panel" data-inspection-id={inspectionId}>
      <h2 className="text-sm font-semibold text-ih-fg-2">{m.editor_compliance_panel_heading()}</h2>

      <ConformancePreview data={data} />

      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4">{m.editor_compliance_dual_signoff()}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SignoffRoleCard role="field_observer" existing={fieldObserver} />
          <SignoffRoleCard role="pcr_reviewer" existing={pcrReviewer} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4">{m.editor_compliance_psq_heading()}</h3>
        <PsqPanel psq={data.psq} />
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4">{m.editor_compliance_doc_review_heading()}</h3>
        <DocReviewSection items={data.documentReview} />
      </section>

      <RelianceSection relianceText={data.relianceText} />
    </div>
  );
}
