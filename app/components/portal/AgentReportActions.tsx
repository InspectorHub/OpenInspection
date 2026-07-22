/**
 * <AgentReportActions> — Spec 3 Task 3 report-landing CTA for an agent
 * viewing a report via their durable report link
 * (/portal/:tenant/i/:inspectionId?token=). Mounted below <ReportView> only
 * when the portal-inspection loader resolved `agentReport?.kind === 'agent'`
 * (server/api/agent/report-context.ts) — a client (or other-kind) recipient
 * never sees this component.
 *
 * hasAccount branches the CTA:
 *   - true  : "Email me a sign-in link" — posts the agent-magic-login intent;
 *     the server EMAILS a single-use sign-in link to the agent's account inbox
 *     (never returns it), so on success we show a "check your email"
 *     confirmation rather than navigating. Emailing (vs. returning the link)
 *     closes the report-link → agent-session takeover vector (#258 review #5).
 *   - false : "Create your free agent account" — a plain link into
 *     /agent-signup with the recipient email + returnTo prefilled.
 *
 * BFF ONLY (feedback_core_bff_no_client_fetch): the "Go to my workspace"
 * click posts through `useFetcher`, which hits the HOST route's own action
 * (app/routes/public/portal-inspection.tsx, "agent-magic-login" intent) —
 * never a client `fetch('/api/...')`. Mirrors the WordExportButton /
 * report-card-stack.tsx action pattern (app/components/portal/sections/report/WordExportButton.tsx).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button, Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface AgentMagicLoginActionResult {
  ok: boolean;
  intent?: string;
  /** True when the server accepted the request and (if an account exists) emailed the sign-in link. */
  sent?: boolean;
}

export interface AgentReportActionsProps {
  tenant: string;
  inspectionId: string;
  /** The durable report token (ctx.token) — same token the report renders under. */
  token: string;
  recipientEmail: string;
  hasAccount: boolean;
  /** The current report path — passed through as ?returnTo= on the signup CTA. */
  reportPath: string;
}

export function AgentReportActions({
  tenant,
  inspectionId,
  token,
  recipientEmail,
  hasAccount,
  reportPath,
}: AgentReportActionsProps) {
  const fetcher = useFetcher<AgentMagicLoginActionResult>();
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  const lastHandled = useRef<AgentMagicLoginActionResult | undefined>(undefined);

  // Consume the action result exactly once per response (mirrors
  // WordExportButton's guard — fetcher.data keeps the same reference across
  // renders). The server emails the sign-in link and answers { sent: true }
  // (anti-oracle — identical whether or not an account exists), so on success
  // we show a "check your email" confirmation instead of navigating anywhere.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data === lastHandled.current) return;
    lastHandled.current = fetcher.data;
    if (fetcher.data.ok) {
      setSent(true);
    } else {
      setError(true);
    }
  }, [fetcher.state, fetcher.data]);

  if (!hasAccount) {
    const signupHref = `/agent-signup?email=${encodeURIComponent(recipientEmail)}&returnTo=${encodeURIComponent(reportPath)}`;
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-8 print:hidden" data-testid="agent-report-actions">
        <Banner
          tone="brand"
          actions={
            <a
              href={signupHref}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-ih-primary-fg hover:opacity-90 transition-opacity"
              data-testid="agent-report-signup-cta"
            >
              {m.agent_report_actions_signup_cta()}
            </a>
          }
        >
          {m.agent_report_actions_signup_hint()}
        </Banner>
      </div>
    );
  }

  const submitting = fetcher.state !== "idle";

  if (sent) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-8 print:hidden" data-testid="agent-report-actions">
        <Banner tone="success">
          <span data-testid="agent-report-workspace-sent">{m.agent_report_actions_workspace_sent()}</span>
        </Banner>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-8 print:hidden" data-testid="agent-report-actions">
      <Banner
        tone="brand"
        actions={
          <Button
            variant="primary"
            size="md"
            disabled={submitting}
            data-testid="agent-report-workspace-cta"
            onClick={() => {
              setError(false);
              fetcher.submit(
                { intent: "agent-magic-login", tenant, inspectionId, token },
                { method: "POST" },
              );
            }}
          >
            {submitting
              ? m.agent_report_actions_workspace_pending()
              : m.agent_report_actions_workspace_cta()}
          </Button>
        }
      >
        {error ? m.agent_report_actions_workspace_error() : m.agent_report_actions_workspace_hint()}
      </Banner>
    </div>
  );
}
