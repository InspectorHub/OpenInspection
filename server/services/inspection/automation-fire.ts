import { drizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../automation.service';
import { resolveAutomationCompanyName } from '../automation/company-name';
import { logger } from '../../lib/logger';

/**
 * Returns the trigger Promise so callers can keep the worker isolate alive
 * via `c.executionCtx.waitUntil(...)`. The previous fire-and-forget version
 * dangled the promise — CF Workers terminated the isolate after the
 * response was sent, so AutomationService.trigger never inserted the
 * automation_logs row, and report.published / inspection.confirmed /
 * inspection.cancelled / inspection.created automations never fired.
 */
export async function fireAutomation(
    db: D1Database, tenantId: string, inspectionId: string, event: string, reportId?: string,
): Promise<void> {
    // Resolved before the trigger so the `{{company_name}}` token renders the
    // tenant's own name instead of the blank the call site used to pass.
    const companyName = await resolveAutomationCompanyName(drizzle(db), tenantId);
    return new AutomationService(db)
        .trigger({
            tenantId, inspectionId, triggerEvent: event, reportBaseUrl: '',
            companyName,
            // Which DELIVERABLE this is about. `report.published` dedups on a
            // synthetic per-event key, and an inspection-only key collapses the
            // radon report's first publish into the standard report's — for
            // ever, not for a window.
            ...(reportId ? { reportId } : {}),
        })
        .catch(err => logger.error('automation trigger failed', { event }, err instanceof Error ? err : undefined));
}
