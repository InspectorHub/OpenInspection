/**
 * Stepwise Resend connection test: a checklist that runs one server step per
 * request (key accepted → permissions → sender domain → real test email →
 * quota → delivery). The server re-derives each step's prerequisites, so the
 * order here only decides what the user sees fill in.
 *
 * Each step goes through the route action (`test-email-step`), never a client
 * fetch. The test email always goes to the signed-in user; the form carries no
 * recipient field.
 */
import { useEffect, useState } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import {
  EMAIL_TEST_STEPS,
  persistedOutcomes,
  type EmailTestStepId,
  type StepOutcome,
  type StepStatus,
} from "~/lib/email-test-steps";
import type { ConnectionTestResult } from "~/lib/connection-test";
import type { action } from "~/routes/settings-communication";
import { m } from "~/paraglide/messages";

type Outcomes = Partial<Record<EmailTestStepId, StepOutcome>>;

const LABEL: Record<EmailTestStepId, () => string> = {
  key_valid: () => m.settings_emailsteps_key_valid(),
  key_scope: () => m.settings_emailsteps_key_scope(),
  sender_domain_verified: () => m.settings_emailsteps_sender_domain_verified(),
  send_test: () => m.settings_emailsteps_send_test(),
  quota: () => m.settings_emailsteps_quota(),
  delivery: () => m.settings_emailsteps_delivery(),
};

const STATUS_LABEL: Record<StepStatus, () => string> = {
  pass: () => m.settings_emailsteps_status_pass(),
  fail: () => m.settings_emailsteps_status_fail(),
  skipped: () => m.settings_emailsteps_status_skipped(),
  pending: () => m.settings_emailsteps_status_pending(),
};

const GLYPH: Record<StepStatus, string> = { pass: "✓", fail: "✗", skipped: "–", pending: "…" };
const TONE: Record<StepStatus, string> = {
  pass: "text-ih-ok-fg",
  fail: "text-ih-bad-fg",
  skipped: "text-ih-fg-3",
  pending: "text-ih-fg-3",
};

export function EmailStepTest({ results }: { results: ConnectionTestResult[] }) {
  const { fetcher, submit, busy: submitting } = useGuardedSubmit<typeof action>();
  const [outcomes, setOutcomes] = useState<Outcomes>(() => persistedOutcomes(results));
  const [queue, setQueue] = useState<EmailTestStepId[]>([]);
  const [active, setActive] = useState<EmailTestStepId | null>(null);
  const [failed, setFailed] = useState(false);

  const start = (steps: EmailTestStepId[]) => {
    const [first, ...rest] = steps;
    setFailed(false);
    setOutcomes((prev) => {
      const next = { ...prev };
      for (const s of steps) delete next[s];
      return next;
    });
    setQueue(rest);
    setActive(first);
    submit({ intent: "test-email-step", step: first }, { method: "post" });
  };

  useEffect(() => {
    if (fetcher.state !== "idle" || !active) return;
    const d = fetcher.data;
    if (!d || d.intent !== "test-email-step" || !("outcome" in d) || d.step !== active) return;
    if (!d.outcome) {
      setFailed(true);
      setQueue([]);
      setActive(null);
      return;
    }
    const outcome = d.outcome;
    setOutcomes((prev) => ({ ...prev, [active]: outcome }));
    // A failed step ends the run: what follows would only repeat the same cause.
    const [next, ...rest] = outcome.status === "fail" ? [] : queue;
    if (next) {
      setQueue(rest);
      setActive(next);
      submit({ intent: "test-email-step", step: next }, { method: "post" });
    } else {
      setActive(null);
    }
  }, [fetcher.state, fetcher.data, active, queue, submit]);

  const busy = active !== null || submitting;
  const btn =
    "h-8 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} aria-busy={busy || undefined} className={btn} onClick={() => start([...EMAIL_TEST_STEPS])}>
          {busy ? m.settings_testconn_busy() : m.settings_testconn_idle()}
        </button>
        <span className="text-[11px] text-ih-fg-3">{m.settings_emailsteps_notice()}</span>
      </div>

      <ul className="flex flex-col gap-1" aria-live="polite">
        {EMAIL_TEST_STEPS.map((step) => {
          const o = outcomes[step];
          const status = o?.status;
          return (
            <li key={step} className="flex flex-wrap items-baseline gap-2 text-[12px]">
              <span
                className={`w-3 shrink-0 text-center font-bold ${status ? TONE[status] : "text-ih-fg-4"}`}
                aria-hidden
              >
                {status ? GLYPH[status] : active === step ? "…" : "·"}
              </span>
              <span className={status ? "text-ih-fg-2" : "text-ih-fg-4"}>{LABEL[step]()}</span>
              {status ? <span className="sr-only">{STATUS_LABEL[status]()}</span> : null}
              {o?.detail ? (
                <span className={status === "fail" ? "text-ih-bad-fg" : "text-ih-fg-3"}>— {o.detail}</span>
              ) : null}
              {step === "delivery" && status === "pending" && !busy ? (
                <button type="button" className="text-ih-primary hover:underline" onClick={() => start(["delivery"])}>
                  {m.settings_emailsteps_recheck()}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {failed ? <span className="text-[12px] text-ih-bad-fg">{m.settings_emailsteps_error()}</span> : null}
    </div>
  );
}
