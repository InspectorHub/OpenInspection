import { useRef, useState } from "react";
import { Button, Modal, SegmentedControl } from "@core/shared-ui";
import { isIgnored, useFieldCommand, useFieldDataSource } from "../../context";
import type {
  CompliancePanelData,
  DocumentReviewItemView,
  PsqView,
  RelianceText,
  ReportSignoffView,
} from "../../data-source-types";
import { formatDateTime } from "../../shared/format";
import { ConfirmDialog } from "../ConfirmDialog";
import { m } from "../../i18n";

/**
 * Commercial PCA Phase M Task 10 — the "Compliance (Full PCA)" editor panel.
 * Rendered ONLY when the inspection's reportTier === 'full_pca' (see the
 * gate in inspection-edit.tsx); light_commercial and residential inspections
 * never mount this panel.
 *
 * Every mutation type gets its OWN `useFieldCommand` instance (signoff per role,
 * remove-signoff per role, PSQ responses, PSQ status, doc-review per item) —
 * one shared guard would drop an unrelated write that arrives while another is
 * in flight (see the B-17 notes-vs-rating bug this project already hit once).
 * Every write is a `compliance` (or `save-pca-narrative`) command of the data
 * source — never a raw client fetch to /api/...; the host's action then calls
 * the Task 6 compliance API.
 *
 * The editor's POSTs skip revalidation (see inspection-edit.tsx's
 * `shouldRevalidate`), so every sub-section keeps its own local optimistic
 * copy of the server row(s) it owns rather than re-reading stale loader data
 * after a write. Sign-off (add/remove) and the doc-review seed have no local
 * optimistic copy — they render straight off `data` (loader props) — so those
 * three call `dataSource.reload()` on an accepted write. PSQ and per-row
 * doc-review keep local state and stay reload-free.
 */

type SignoffRole = ReportSignoffView["role"];

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
      <ul className="text-[11px] text-ih-fg-3 space-y-0.5">
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

function SignoffRoleCard({
  inspectionId,
  role,
  existing,
}: {
  inspectionId: string;
  role: SignoffRole;
  existing: ReportSignoffView | null;
}) {
  const dataSource = useFieldDataSource();
  const session = dataSource.session();
  const displayTz = session.timeZone ?? "UTC";
  const locale = session.locale;
  // Independent guards per role AND per mutation type — a remove on one
  // role must never drop an in-flight sign-off on the other.
  // #106 - a sign-off is an attestation and its removal retracts one. Both go
  // through the guard, and every control on this card is already disabled while
  // its own write is in flight, so a refused click is not reachable.
  const { run: runSign, busy: saving } = useFieldCommand(inspectionId);
  const { run: runRemove, busy: removing } = useFieldCommand(inspectionId);
  // Everyone signs as themselves. An owner or manager may instead name another person, by
  // typing both fields (the server refuses just one); left blank means "me" and the server fills in the signed-in user.
  // Mirrors isAdminRole (server/lib/auth/roles.ts): this published package cannot import the server tree.
  // eslint-disable-next-line no-restricted-syntax
  const mayNamePerson = session.role === "owner" || session.role === "manager";
  const [personId, setPersonId] = useState("");
  const [name, setName] = useState("");
  const [license, setLicense] = useState(existing?.license ?? "");
  const [dualRole, setDualRole] = useState(existing?.dualRole ?? false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The server refuses one of the two without the other, so a half-typed pair is not sent.
  const [pairTried, setPairTried] = useState(false);
  const pairIncomplete = personId.trim() === "" !== (name.trim() === "");

  // This card renders straight off `existing` (loader props) — no local
  // optimistic copy of "signed" state — so a successful sign-off or removal
  // must reload the editor's data or the card never leaves its stale state.
  // One reload per accepted write: the answer settles once, so there is no
  // re-render storm to guard against.
  const submitSignoff = async () => {
    if (pairIncomplete) { setPairTried(true); return; }
    const answer = await runSign({
      type: "compliance",
      op: "signoff",
      role,
      ...(personId.trim() ? { personId: personId.trim() } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
      license: license.trim(),
      dualRole,
    });
    if (isIgnored(answer)) return;
    if (answer.ok) dataSource.reload();
    else dataSource.notify(answer.error ?? m.editor_compliance_signoff_failed(), "error");
  };

  const confirmRemove = async () => {
    // Keep the confirmation open while a removal is already in flight: that
    // click sends nothing, and closing would claim the removal was requested.
    if (removing) return;
    setConfirmOpen(false);
    const answer = await runRemove({ type: "compliance", op: "remove-signoff", role });
    if (!isIgnored(answer) && answer.ok) dataSource.reload();
  };

  return (
    <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3 space-y-2" data-testid={`signoff-${role}`}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-ih-fg-2">{roleLabel(role)}</span>
        <span className={`text-[11px] font-bold ${existing ? "text-ih-ok-fg" : "text-ih-fg-3"}`}>
          {existing ? m.editor_compliance_signed() : m.editor_compliance_not_signed()}
        </span>
      </div>

      {existing ? (
        <div className="text-[12px] text-ih-fg-2 space-y-1">
          <div>{existing.name}{existing.license ? m.editor_compliance_license_suffix({ license: existing.license }) : ""}</div>
          {existing.signedAt ? (
            <div className="text-[11px] text-ih-fg-3">{m.editor_compliance_signed()} {formatDateTime(existing.signedAt, { locale, timeZone: displayTz })}</div>
          ) : null}
          <Button variant="danger-link" size="sm" pending={removing} onClick={() => setConfirmOpen(true)}>
            {removing ? m.editor_compliance_removing() : m.common_remove()}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {mayNamePerson && ([[m.editor_compliance_person_id(), personId, setPersonId], [m.editor_compliance_name(), name, setName]] as const).map(([placeholder, value, set]) => (
            <input key={placeholder} placeholder={placeholder} value={value} onChange={(e) => set(e.target.value)} disabled={saving} className="ih-input w-full" />
          ))}
          <input
            placeholder={m.editor_compliance_license_optional()}
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            disabled={saving}
            className="ih-input w-full"
          />
          {pairTried && pairIncomplete ? <p role="alert" className="text-[11px] text-ih-bad-fg">{m.editor_compliance_signoff_pair_needed()}</p> : null}
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
            onClick={() => void submitSignoff()}
            pending={saving}
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
        onConfirm={() => void confirmRemove()}
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

function PsqPanel({ inspectionId, psq }: { inspectionId: string; psq: PsqView | null }) {
  // Separate guard per mutation TYPE (responses vs status) — a status click
  // must not drop an in-flight responses save, and vice versa.
  // #106 - the responses save writes the questionnaire and the status write
  // records that it was sent, received or declined.
  const { run: runResponses, busy: savingResponses } = useFieldCommand(inspectionId);
  const { run: runStatus, busy: settingStatus } = useFieldCommand(inspectionId);
  const [responses, setResponses] = useState<Record<string, string>>(() => normalizeResponses(psq?.responses));
  const [status, setStatus] = useState<PsqView["status"] | null>(psq?.status ?? null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");


  const commitResponses = () => {
    void runResponses({ type: "compliance", op: "psq", responses });
  };

  const applyStatus = (next: "sent" | "received") => {
    setStatus(next);
    void runStatus({ type: "compliance", op: "psq-status", status: next });
  };

  const confirmDecline = () => {
    // Only move the local status and clear the dialog while no status write is
    // in flight - that click would send nothing, and showing "declined" for it
    // would be a claim about the record that is not true.
    if (settingStatus) return;
    void runStatus({
      type: "compliance",
      op: "psq-status",
      status: "declined",
      reason: declineReason.trim() || "(no reason provided)",
    });
    setStatus("declined");
    setDeclineOpen(false);
    setDeclineReason("");
  };

  return (
    <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3 space-y-3" data-testid="psq-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">{m.editor_compliance_status()}</span>
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

function DocReviewRow({ inspectionId, item }: { inspectionId: string; item: DocumentReviewItemView }) {
  // One guard PER ROW (own component instance) — toggling one document's
  // checkbox must never drop another row's in-flight notes save.
  // #106 - one guard per ROW: toggling one document must not contend with
  // another's in-flight save. Every control in the row is `disabled={busy}`.
  const { run, busy } = useFieldCommand(inspectionId);
  const [local, setLocal] = useState(item);

  const submitPatch = (next: DocumentReviewItemView) => {
    setLocal(next);
    void run({
      type: "compliance",
      op: "doc-review",
      documentKey: next.documentKey,
      requested: next.requested,
      received: next.received,
      reviewed: next.reviewed,
      na: next.na,
      notes: next.notes,
    });
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

function DocReviewSection({ inspectionId, items }: { inspectionId: string; items: DocumentReviewItemView[] }) {
  const dataSource = useFieldDataSource();
  // Seeding the standard checklist is its own mutation type/guard too.
  // #106 - seeding creates the whole standard checklist server-side; twice
  // would create it twice.
  const { run, busy: seeding } = useFieldCommand(inspectionId);

  // Seeding creates rows server-side but this section renders `items`
  // straight from loader props — without a reload the checklist stays
  // empty after a successful seed. Same pattern as SignoffRoleCard.
  const seed = async () => {
    const answer = await run({ type: "compliance", op: "doc-review-seed" });
    if (!isIgnored(answer) && answer.ok) dataSource.reload();
  };

  return (
    <div className="space-y-2" data-testid="doc-review-section">
      {items.length === 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-ih-fg-3">{m.editor_compliance_no_docs()}</p>
          <Button
            variant="link"
            size="sm"
            pending={seeding}
            onClick={() => void seed()}
          >
            {seeding ? m.common_loading() : m.editor_compliance_load_checklist()}
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <DocReviewRow key={item.documentKey} inspectionId={inspectionId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reliance & Limitations (M10)                                       */
/* ------------------------------------------------------------------ */

function relianceFields(): { key: keyof RelianceText; label: string }[] {
  return [
    { key: "userReliance", label: m.editor_compliance_reliance_userReliance() },
    { key: "pointInTime", label: m.editor_compliance_reliance_pointInTime() },
    { key: "siteSpecific", label: m.editor_compliance_reliance_siteSpecific() },
  ];
}

// One guard PER reliance clause — the three clauses save independently, so a
// save of one must never drop another's in-flight PATCH. This is the file-wide
// own-guard rule (see the header comment + the B-17 notes-vs-rating bug this
// project already hit): a single guard shared across the three would drop
// the second field's save when it blurs while the first is still in flight.
function RelianceFieldRow({
  inspectionId,
  fieldKey,
  label,
  initial,
}: {
  inspectionId: string;
  fieldKey: keyof RelianceText;
  label: string;
  initial: string;
}) {
  // #106 - one guard per FIELD (this is one component instance per field), which
  // is what keeps the guard from refusing the next field's blur. The textarea is
  // `disabled={busy}` for the round trip.
  const { run, busy } = useFieldCommand(inspectionId);
  const [value, setValue] = useState(initial);
  // Last value we actually persisted — lets us skip a no-op save when a field
  // is blurred without an edit (e.g. tabbing through just to read it), which
  // would otherwise write a redundant PATCH + pca_narrative.update audit entry
  // on every pass. POSTs skip revalidation, so the local copy is the optimistic
  // source of truth like PsqPanel / DocReviewRow.
  const savedRef = useRef(initial);

  const commit = async () => {
    if (value === savedRef.current) return;
    const answer = await run({ type: "save-pca-narrative", key: fieldKey, value });
    // Record the value as saved only for a call the guard accepted, or a
    // refused blur would be remembered as persisted and never retried.
    if (isIgnored(answer)) return;
    savedRef.current = value;
  };

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ih-fg-3">{label}</span>
      <textarea
        rows={2}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        className="w-full rounded border border-ih-border bg-ih-bg-app p-2 text-[12px] text-ih-fg-1"
      />
    </label>
  );
}

function RelianceSection({ inspectionId, relianceText }: { inspectionId: string; relianceText: RelianceText }) {
  return (
    <section className="space-y-1.5" data-testid="reliance-section">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3">{m.editor_compliance_reliance_heading()}</h3>
      <div className="space-y-2">
        {relianceFields().map((f) => (
          <RelianceFieldRow key={f.key} inspectionId={inspectionId} fieldKey={f.key} label={f.label} initial={relianceText[f.key]} />
        ))}
      </div>
      <p className="text-[11px] text-ih-fg-3 italic">
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
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3">{m.editor_compliance_dual_signoff()}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SignoffRoleCard inspectionId={inspectionId} role="field_observer" existing={fieldObserver} />
          <SignoffRoleCard inspectionId={inspectionId} role="pcr_reviewer" existing={pcrReviewer} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3">{m.editor_compliance_psq_heading()}</h3>
        <PsqPanel inspectionId={inspectionId} psq={data.psq} />
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3">{m.editor_compliance_doc_review_heading()}</h3>
        <DocReviewSection inspectionId={inspectionId} items={data.documentReview} />
      </section>

      <RelianceSection inspectionId={inspectionId} relianceText={data.relianceText} />
    </div>
  );
}
