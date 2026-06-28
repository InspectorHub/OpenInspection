// apps/openinspection/server/lib/automation-core/deliver.ts
import type {
  TemplateStore, Transport, AutomationLogger, Clock, CoreAction, DeliveryOutcome,
} from './ports';
import { interpolate } from './interpolate';
import { checkRequiredVars } from './required-vars';

export interface DeliverArgs {
  tenantId: string;
  logId: string;
  to: string;
  action: CoreAction;
  vars: Record<string, string>;
  /** Fail-closed vars (name → resolved value/undefined). See checkRequiredVars. */
  requiredVars: Record<string, string | undefined>;
  deps: { templates: TemplateStore; transport: Transport; logger: AutomationLogger; clock: Clock };
}

/**
 * Generic delivery orchestration: resolve template → requiredVars guard →
 * interpolate → send on the action's channel → record the outcome. Mirrors OI
 * flush()'s per-log sequence so the characterization snapshot is unchanged when
 * OI routes through this. The skip reason for a missing required var is
 * "<key> not configured" — byte-identical to the old review_url skip.
 */
export async function deliverAction(args: DeliverArgs): Promise<DeliveryOutcome> {
  const { tenantId, logId, to, action, vars, requiredVars, deps } = args;

  const tpl = await deps.templates.resolve(tenantId, action.templateId);
  if (!tpl) {
    const out: DeliveryOutcome = { status: 'failed', error: 'template not found' };
    await deps.logger.record({ logId, status: out.status, ...(out.error !== undefined ? { error: out.error } : {}) });
    return out;
  }

  const templates = [tpl.subject ?? '', tpl.body];
  const guard = checkRequiredVars(templates, requiredVars);
  if (!guard.ok) {
    const out: DeliveryOutcome = { status: 'skipped', error: `${guard.missingKey} not configured` };
    await deps.logger.record({ logId, status: out.status, ...(out.error !== undefined ? { error: out.error } : {}) });
    return out;
  }

  const subject = tpl.subject !== undefined ? interpolate(tpl.subject, vars) : undefined;
  const body = interpolate(tpl.body, vars);

  const result = action.channel === 'sms'
    ? await deps.transport.sendSms({ tenantId, to, body })
    : await deps.transport.sendEmail({ tenantId, to, subject: subject ?? '', html: body });

  if (result.ok) {
    await deps.logger.record({ logId, status: 'sent', deliveredAtMs: deps.clock.nowMs() });
    return { status: 'sent' };
  }
  await deps.logger.record({ logId, status: 'failed', error: result.error });
  return { status: 'failed', error: result.error };
}
