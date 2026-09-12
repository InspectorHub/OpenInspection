import { useState } from "react";
import { Link } from "react-router";
import { Card, Icon } from "@core/shared-ui";
import type { OnboardingStep } from "~/lib/onboarding-progress";
import { allDone } from "~/lib/onboarding-progress";
import { m } from "~/paraglide/messages";

interface OnboardingChecklistProps {
  steps: OnboardingStep[];
  dismissed: boolean;
  /** Called when the user clicks the "Dismiss" button. The parent handles the
   *  optimistic state update and posts the intent to the server. */
  onDismiss: () => void;
  /** Called when the user clicks the "Create your first inspection" step.
   *  The parent opens the New Inspection wizard. */
  onOpenWizard: () => void;
}

/**
 * IA-12 — Dashboard onboarding checklist.
 *
 * Renders a "Getting started" banner with the ordered setup steps. Each
 * completed step shows a filled check circle and struck/muted label.
 *
 * ── Dismissing collapses it; it does not destroy it ─────────────────────────
 * Dismiss used to return `null` for ever, and the workspace's own setup — its
 * company name, its timezone, its first template — became unreachable from the
 * only page that had ever mentioned it. There was no second entry point
 * anywhere in the product, so the cost of one click was permanent.
 *
 * So a dismissed checklist collapses to ONE row naming its own progress, and
 * that row reopens it. The dismissal still persists (the row is a line, not a
 * card, and it is lighter than what it replaces — which is also the right answer
 * for an empty workspace); what changes is that it is no longer a one-way door.
 * Reopening is deliberately NOT persisted: the stored answer is still "put
 * away", and someone who looked once has not asked for it back permanently.
 *
 * Nothing renders once every step is done — then there is no setup left to
 * return to, and the row would be furniture.
 *
 * Design tokens only — no inline Tailwind colour literals.
 */
export function OnboardingChecklist({
  steps,
  dismissed,
  onDismiss,
  onOpenWizard,
}: OnboardingChecklistProps) {
  // Session-only: see the header. A dismissed checklist that was reopened is
  // still dismissed as far as the server is concerned.
  const [reopened, setReopened] = useState(false);

  // Finished setup is the one case with nothing to come back to.
  if (allDone(steps)) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;

  if (dismissed && !reopened) {
    return (
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setReopened(true)}
          className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-ih-bg-muted transition-colors"
        >
          <span className="text-[13px] font-bold text-ih-fg-2">{m.dashboard_onboarding_title()}</span>
          <span className="text-[12px] font-medium text-ih-fg-3">
            {m.dashboard_onboarding_progress({ done: doneCount, total })}
          </span>
          <Icon name="chevD" size={16} className="ml-auto shrink-0 text-ih-fg-4" />
        </button>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-ih-border">
        <div className="flex items-center gap-3">
          <h2 className="text-[14px] font-bold text-ih-fg-1">{m.dashboard_onboarding_title()}</h2>
          <span className="text-[12px] font-medium text-ih-fg-3">
            {m.dashboard_onboarding_progress({ done: doneCount, total })}
          </span>
        </div>
        {/* Two words because they are two different actions: Dismiss puts the
            checklist away (and persists that), Hide only closes what this
            session reopened. One label for both would promise a second
            dismissal that does not happen. */}
        <button
          type="button"
          onClick={dismissed ? () => setReopened(false) : onDismiss}
          className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-2 transition-colors"
        >
          {dismissed ? m.dashboard_onboarding_hide() : m.dashboard_onboarding_dismiss()}
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-[3px] bg-ih-bg-muted">
        <div
          className="h-full bg-ih-primary transition-all duration-500"
          style={{ width: `${Math.round((doneCount / total) * 100)}%` }}
        />
      </div>

      {/* Step list */}
      <ul className="divide-y divide-ih-border">
        {steps.map((step) => {
          const content = (
            <div className="flex items-center gap-3 px-5 py-3 group">
              {/* Circle indicator */}
              <span
                aria-hidden="true"
                className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  step.done
                    ? "border-ih-ok bg-ih-ok-bg text-ih-ok-fg"
                    : "border-ih-border bg-transparent"
                }`}
              >
                {step.done && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 12 12"
                    fill="none"
                    className="w-3 h-3"
                  >
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>

              {/* Label */}
              <span
                className={`text-[13px] transition-colors ${
                  step.done
                    ? "line-through text-ih-fg-3"
                    : "text-ih-fg-1 group-hover:text-ih-primary-text"
                }`}
              >
                {step.label}
              </span>

              {/* Arrow for incomplete steps */}
              {!step.done && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="w-3.5 h-3.5 ml-auto shrink-0 text-ih-fg-4 group-hover:text-ih-primary-text transition-colors"
                >
                  <path
                    d="M6 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          );

          return (
            <li key={step.id}>
              {step.href === "#new-inspection" ? (
                <button
                  type="button"
                  onClick={step.done ? undefined : onOpenWizard}
                  disabled={step.done}
                  className="w-full text-left disabled:cursor-default"
                >
                  {content}
                </button>
              ) : (
                <Link to={step.href} className="block">
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
