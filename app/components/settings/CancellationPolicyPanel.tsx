import { useState } from "react";
import { Link, useFetcher } from "react-router";
import {
  clauseStateOf,
  feeChoiceOf,
  cancellationPolicyFromForm,
  parseCancellationPolicy,
  type FeeChoice,
} from "~/lib/cancellation-policy-form";
import {
  policyChargesFees,
  type CancellationPolicy,
} from "../../../server/lib/billing/cancellation-policy";
import { CancellationFeeRow } from "./CancellationFeeRow";
import type { action } from "~/routes/settings-booking";
import { m } from "~/paraglide/messages";

/**
 * The company cancellation ladder, and the agreement clause it depends on.
 *
 * WHY THE CLAUSE IS IN THIS PANEL AND NOT ON THE AGREEMENTS PAGE. A fee is only
 * collectable because the signed agreement says it is — so the two facts are one
 * decision, and splitting them across two screens produces the state this panel
 * exists to make impossible: a configured fee whose clause nobody confirmed. The
 * server refuses that combination outright (`BrandingService.updateBranding`);
 * what a person needs here is to see WHY before the refusal, and to fix it in the
 * same save. The API applies the attestation before the policy for exactly that
 * reason.
 *
 * FOUR CLAUSE STATES, NOT A CHECKBOX. `clauseStateOf` returns
 * not-required / never-attested / attested / drifted, and the fourth is the one
 * that justifies the shape. `getCancellationAttestation` compares the attested
 * version against the agreement's CURRENT version, so editing the agreement —
 * for any reason, including a typo — clears the confirmation. That is correct and
 * it is surprising, so the drifted copy says it outright rather than leaving an
 * operator to discover it as a failed save.
 *
 * ⚠️ `current` is computed on the SERVER and shipped in the branding payload. Do
 * NOT derive it here from the raw columns plus the agreement list: that is a
 * second copy of the invalidation rule, and the copy the panel shows would
 * eventually disagree with the one the fee gate reads.
 *
 * WHAT IT REUSES, deliberately. `SegmentedControl` + `MoneyInput` +
 * eager-after-error are the same three pieces `BookingPoliciesPanel` uses for the
 * deposit. A cancellation fee and a deposit are both "a number this company
 * charges", so a second visual language for one of them would read as a
 * different kind of setting.
 */

const NUM_FIELD =
  "h-8 w-20 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] " +
  "text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary";

/** One agreement template, as much of it as this panel needs. */
export interface ClauseAgreement {
  id: string;
  name?: string | undefined;
}

/** The attestation state, exactly as the branding endpoint reports it. */
export interface ClauseState {
  current: boolean;
  everAttested: boolean;
  agreementId: string | null;
}

interface Props {
  /** The stored policy. NULL is where every company starts. */
  policy: CancellationPolicy | null;
  clause: ClauseState;
  agreements: ClauseAgreement[];
}

export function CancellationPolicyPanel({ policy, clause, agreements }: Props) {
  const fetcher = useFetcher<typeof action>();

  const [noticeHoursText, setNoticeHoursText] = useState(
    policy ? String(policy.noticeHours) : "24",
  );
  const [lateChoice, setLateChoice] = useState<FeeChoice>(feeChoiceOf(policy?.lateFee));
  const [latePercent, setLatePercent] = useState(
    policy?.lateFee.type === "percent" ? String(policy.lateFee.percent) : "",
  );
  const [lateAmount, setLateAmount] = useState<number | null>(
    policy?.lateFee.type === "fixed" ? policy.lateFee.amountCents : null,
  );
  const [noShowChoice, setNoShowChoice] = useState<FeeChoice>(feeChoiceOf(policy?.noShowFee));
  const [noShowPercent, setNoShowPercent] = useState(
    policy?.noShowFee.type === "percent" ? String(policy.noShowFee.percent) : "",
  );
  const [noShowAmount, setNoShowAmount] = useState<number | null>(
    policy?.noShowFee.type === "fixed" ? policy.noShowFee.amountCents : null,
  );

  /** The agreement being confirmed in THIS save, if any. */
  const [attesting, setAttesting] = useState<string | null>(null);
  /** Eager-after-error: silent until a save is attempted, live from then on. */
  const [attempted, setAttempted] = useState(false);

  const built = cancellationPolicyFromForm({
    noticeHoursText,
    late: { choice: lateChoice, percentText: latePercent, amountCents: lateAmount },
    noShow: { choice: noShowChoice, percentText: noShowPercent, amountCents: noShowAmount },
  });

  // The FORM's answer, which is what the SAVE must be judged against. The clause
  // display below reads the STORED policy instead — see `clauseStateOf`.
  const willChargeFees = built.ok && policyChargesFees(built.policy);

  /**
   * Whether the person has DECLARED an intent to charge, regardless of whether
   * the number is filled in yet.
   *
   * ⚠️ Separate from `willChargeFees` because that one needs the policy to parse,
   * and driving the clause requirement off it hid the requirement until a valid
   * number was typed. Found in the browser, invisible to the unit tests: picking
   * "Percent of the price" with an empty box removed the "you charge nothing"
   * line and replaced it with NOTHING — no requirement, no guidance, no error.
   * The clause is a precondition of the intent, so it appears with the intent.
   */
  const intendsToCharge = lateChoice !== "none" || noShowChoice !== "none";
  const clauseSatisfied = clause.current || attesting !== null;

  const state = clauseStateOf({
    stored: policy,
    attestationCurrent: clause.current,
    everAttested: clause.everAttested,
    chargesFees: policyChargesFees(policy),
  });

  const named = agreements.find((a) => a.id === clause.agreementId);
  const clauseName = named?.name ?? m.settings_cancellation_clause_pick_none();

  const formError = attempted && !built.ok
    ? built.rung === "notice"
      ? m.settings_cancellation_error_notice()
      : built.field === "percent"
        ? m.settings_cancellation_error_percent()
        : m.settings_cancellation_error_amount()
    : null;
  const clauseError =
    attempted && intendsToCharge && !clauseSatisfied
      ? m.settings_cancellation_clause_required()
      : null;

  const saving = fetcher.state !== "idle";
  const settled = fetcher.state === "idle" && fetcher.data?.intent === "cancellation-policy-save";
  const saved = settled && fetcher.data?.ok === true;
  const failed = settled && fetcher.data?.ok === false;

  function save() {
    setAttempted(true);
    if (!built.ok) return;
    // Refused here rather than sent. The server refuses it too — this is the
    // second of two gates, and it exists because the server's refusal arrives
    // as a sentence in a red line, with no way to see WHICH control caused it.
    if (willChargeFees && !clauseSatisfied) return;
    fetcher.submit(
      {
        intent: "cancellation-policy-save",
        cancellationPolicy: JSON.stringify(built.policy),
        // Only when something is being confirmed in this save. An absent key
        // leaves an existing attestation alone; sending an empty string would
        // read as a withdrawal.
        ...(attesting !== null ? { attestCancellationClause: attesting } : {}),
      },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_cancellation_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_cancellation_desc()}</p>
      </div>

      <div className="space-y-2">
        <span className="block text-[13px] font-bold text-ih-fg-1">
          {m.settings_cancellation_notice_label()}
        </span>
        <span className="block text-[12px] text-ih-fg-3">
          {m.settings_cancellation_notice_desc()}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            step="1"
            className={NUM_FIELD}
            value={noticeHoursText}
            onChange={(e) => setNoticeHoursText(e.target.value)}
            aria-label={m.settings_cancellation_notice_aria()}
          />
          <span className="text-[13px] text-ih-fg-3">
            {m.settings_cancellation_notice_unit()}
          </span>
        </div>
      </div>

      <div className="border-t border-ih-border pt-4 space-y-4">
        <CancellationFeeRow
          label={m.settings_cancellation_late_label()}
          ariaLabel={m.settings_cancellation_late_aria()}
          choice={lateChoice}
          percentText={latePercent}
          amountCents={lateAmount}
          onChoice={setLateChoice}
          onPercent={setLatePercent}
          onAmount={setLateAmount}
        />
        <CancellationFeeRow
          label={m.settings_cancellation_noshow_label()}
          ariaLabel={m.settings_cancellation_noshow_aria()}
          choice={noShowChoice}
          percentText={noShowPercent}
          amountCents={noShowAmount}
          onChoice={setNoShowChoice}
          onPercent={setNoShowPercent}
          onAmount={setNoShowAmount}
        />
        {/* Charging nothing is an answer, not an unfinished form. Every company
            starts here, and saying so is the difference between "nothing is
            charged" and "this looks half-filled". */}
        {!intendsToCharge && built.ok && (
          <p className="text-[12px] text-ih-fg-3">{m.settings_cancellation_off()}</p>
        )}
      </div>

      {/* The clause. Shown whenever fees are configured OR being configured —
          a company setting a fee for the first time needs the requirement in
          front of them before the save, not after it fails. */}
      {(intendsToCharge || state !== "not-required") && (
        <div className="border-t border-ih-border pt-4 space-y-2">
          <span className="block text-[13px] font-bold text-ih-fg-1">
            {m.settings_cancellation_clause_heading()}
          </span>

          {state === "attested" && attesting === null && (
            <p className="text-[12px] text-ih-ok-fg">
              {m.settings_cancellation_clause_attested({ name: clauseName })}
            </p>
          )}

          {state === "drifted" && (
            <p className="text-[12px] text-ih-watch-fg">
              {m.settings_cancellation_clause_drifted({ name: clauseName })}
            </p>
          )}

          {!clause.current && (
            <p className="text-[12px] text-ih-fg-3">
              {m.settings_cancellation_clause_never()}
            </p>
          )}

          {!clause.current && agreements.length === 0 && (
            <p className="text-[12px] text-ih-watch-fg">
              {m.settings_cancellation_clause_no_agreements()}{" "}
              {/* Named destination, not just an instruction. A workspace with no
                  agreements cannot act on "create one" from here, and this panel
                  is where they find out they need one — so it is also where the
                  way out belongs. */}
              <Link to="/agreements" className="font-semibold text-ih-primary-text hover:underline">
                {m.settings_cancellation_clause_create_link()}
              </Link>
            </p>
          )}

          {!clause.current && agreements.length > 0 && (
            <div className="space-y-2">
              <label
                className="block text-[12px] text-ih-fg-3"
                htmlFor="cancellation-clause-agreement"
              >
                {m.settings_cancellation_clause_pick_label()}
              </label>
              <select
                id="cancellation-clause-agreement"
                className="h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
                value={attesting ?? ""}
                onChange={(e) => setAttesting(e.target.value || null)}
              >
                <option value="">{m.settings_cancellation_clause_pick_none()}</option>
                {agreements.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.id}
                  </option>
                ))}
              </select>
              {/* A confirmation, not a toggle: ticking it is the statement, and
                  it is only meaningful once an agreement is named. */}
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={attesting !== null}
                  disabled={attesting === null}
                  onChange={(e) => { if (!e.target.checked) setAttesting(null); }}
                  className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
                />
                <span className="text-[12px] text-ih-fg-2">
                  {state === "drifted"
                    ? m.settings_cancellation_clause_confirm_again()
                    : m.settings_cancellation_clause_confirm()}
                </span>
              </label>
            </div>
          )}

          {clauseError && <p className="text-[12px] text-ih-bad-fg">{clauseError}</p>}
        </div>
      )}

      {formError && <p className="text-[12px] text-ih-bad-fg">{formError}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? m.settings_holiday_save_pending() : m.settings_cancellation_save()}
        </button>
        {saved && (
          <span className="text-[13px] text-ih-ok-fg font-bold">
            {m.settings_cancellation_saved()}
          </span>
        )}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? m.settings_cancellation_save_failed()}
          </span>
        )}
      </div>
    </section>
  );
}

/** The agreement list, reduced to what the clause picker shows. Lives here
 *  rather than in the route so the loader stays plumbing and the shape it
 *  produces is owned by the component that consumes it. */
export function readClauseAgreements(body: unknown): ClauseAgreement[] {
  const rows = (body as { data?: Array<Record<string, unknown>> } | null)?.data ?? [];
  return rows.map((a) => ({
    id: String(a.id),
    name: typeof a.name === "string" ? a.name : undefined,
  }));
}

/** Read the panel's props out of a branding payload the typed client cannot
 *  describe. Exported so the route's loader stays plumbing. */
export function readCancellationSettings(branding: Record<string, unknown> | undefined): {
  policy: CancellationPolicy | null;
  clause: ClauseState;
} {
  const raw = (branding?.cancellationClause ?? {}) as Record<string, unknown>;
  return {
    policy: parseCancellationPolicy(branding?.cancellationPolicy),
    clause: {
      current: raw.current === true,
      everAttested: raw.everAttested === true,
      agreementId: typeof raw.agreementId === "string" ? raw.agreementId : null,
    },
  };
}
