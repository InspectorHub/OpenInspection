import { Link } from "react-router";
import { Card } from "@core/shared-ui";
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
 * Renders a "Getting started" banner with four ordered steps. Each completed
 * step shows a filled check circle and struck/muted label. When dismissed or
 * all steps are done the component renders nothing.
 *
 * Design tokens only — no inline Tailwind colour literals.
 */
export function OnboardingChecklist({
  steps,
  dismissed,
  onDismiss,
  onOpenWizard,
}: OnboardingChecklistProps) {
  // Auto-hide when all steps are complete or user has dismissed.
  if (dismissed || allDone(steps)) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;

  return (
    <Card className="overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-ih-border">
        <div className="flex items-center gap-3">
          <h2 className="text-[14px] font-bold text-ih-fg-1">{m.dashboard_onboarding_title()}</h2>
          <span className="text-[12px] font-medium text-ih-fg-4">
            {m.dashboard_onboarding_progress({ done: doneCount, total })}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[12px] font-medium text-ih-fg-4 hover:text-ih-fg-2 transition-colors"
        >
          {m.dashboard_onboarding_dismiss()}
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
                    ? "line-through text-ih-fg-4"
                    : "text-ih-fg-1 group-hover:text-ih-primary"
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
                  className="w-3.5 h-3.5 ml-auto shrink-0 text-ih-fg-4 group-hover:text-ih-primary transition-colors"
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
