/**
 * Stepwise "Test connection": a checklist that runs one server step per request.
 * The server re-derives each step's prerequisites, so the order here only
 * decides what the user sees fill in. Used by the Resend panel (six steps) and
 * the Stripe panel (three read-only steps).
 *
 * Each step goes through the route action (`intent`), never a client fetch. A
 * failed step ends the run: what follows would only repeat the same cause.
 */
import { useEffect, useRef, useState } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { persistedOutcomes, type StepOutcome, type StepStatus } from "~/lib/test-steps";
import type { ConnectionTestResult } from "~/lib/connection-test";
import { m } from "~/paraglide/messages";
import { pendingProps, PENDING_CLASS } from "@core/shared-ui";

/** What the route action returns for one step (see `app/lib/test-step.server.ts`). */
interface StepActionData {
  intent?: string;
  step?: string | null;
  outcome?: StepOutcome | null;
}

const STATUS_LABEL: Record<StepStatus, () => string> = {
  pass: () => m.settings_teststeps_status_pass(),
  fail: () => m.settings_teststeps_status_fail(),
  skipped: () => m.settings_teststeps_status_skipped(),
  pending: () => m.settings_teststeps_status_pending(),
};

const GLYPH: Record<StepStatus, string> = { pass: "✓", fail: "✗", skipped: "–", pending: "…" };
const TONE: Record<StepStatus, string> = {
  pass: "text-ih-ok-fg",
  fail: "text-ih-bad-fg",
  skipped: "text-ih-fg-3",
  pending: "text-ih-fg-3",
};

export function StepChecklist({
  target,
  intent,
  steps,
  label,
  results,
  notice,
  recheckStep,
}: {
  target: ConnectionTestResult["target"];
  /** The route action intent that runs ONE step (posted with a `step` field). */
  intent: string;
  steps: readonly string[];
  label: (step: string) => string;
  results: ConnectionTestResult[];
  /** One line shown beside the button, for a step with a side effect. */
  notice?: string;
  /** A step that can stay "waiting" and offers a re-check link. */
  recheckStep?: string;
}) {
  const { fetcher, submit, busy: submitting } = useGuardedSubmit<StepActionData>();
  const [outcomes, setOutcomes] = useState<Record<string, StepOutcome>>(() => persistedOutcomes(results, target, steps));
  const [queue, setQueue] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The last response already applied. A re-run starts with the previous run's
  // data still on the fetcher; it must not be mistaken for the new answer.
  const handled = useRef<unknown>(null);

  const start = (run: string[]) => {
    const [first, ...rest] = run;
    setFailed(false);
    setOutcomes((prev) => {
      const next = { ...prev };
      for (const s of run) delete next[s];
      return next;
    });
    setQueue(rest);
    setActive(first);
    submit({ intent, step: first }, { method: "post" });
  };

  useEffect(() => {
    if (fetcher.state !== "idle" || !active) return;
    const d = fetcher.data;
    if (!d || d.intent !== intent || d.step !== active || d === handled.current) return;
    handled.current = d;
    const outcome = d.outcome;
    if (!outcome) {
      setFailed(true);
      setQueue([]);
      setActive(null);
      return;
    }
    setOutcomes((prev) => ({ ...prev, [active]: outcome }));
    const [next, ...rest] = outcome.status === "fail" ? [] : queue;
    if (next) {
      setQueue(rest);
      setActive(next);
      submit({ intent, step: next }, { method: "post" });
    } else {
      setActive(null);
    }
  }, [fetcher.state, fetcher.data, active, queue, submit, intent]);

  const busy = active !== null || submitting;
  const btn =
    `h-8 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors ${PENDING_CLASS}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-busy={busy || undefined} className={btn} {...pendingProps(busy, () => start([...steps]))}>
          {busy ? m.settings_testconn_busy() : m.settings_testconn_idle()}
        </button>
        {notice ? <span className="text-[11px] text-ih-fg-3">{notice}</span> : null}
      </div>

      <ul className="flex flex-col gap-1" aria-live="polite">
        {steps.map((step) => {
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
              <span className={status ? "text-ih-fg-2" : "text-ih-fg-4"}>{label(step)}</span>
              {status ? <span className="sr-only">{STATUS_LABEL[status]()}</span> : null}
              {o?.detail ? (
                <span className={status === "fail" ? "text-ih-bad-fg" : "text-ih-fg-3"}>— {o.detail}</span>
              ) : null}
              {step === recheckStep && status === "pending" && !busy ? (
                <button type="button" className="text-ih-primary hover:underline" onClick={() => start([step])}>
                  {m.settings_teststeps_recheck()}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {failed ? <span className="text-[12px] text-ih-bad-fg">{m.settings_teststeps_error()}</span> : null}
    </div>
  );
}
