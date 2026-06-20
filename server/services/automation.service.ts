import { AutomationBase, SMS_DISCLOSURE_V1 } from './automation/shared';
import { AutomationCore } from './automation/core';
import { AutomationTrigger } from './automation/trigger';
import { AutomationConditions } from './automation/conditions';
import { AutomationSms } from './automation/sms';
import { AutomationDelivery } from './automation/delivery';
import { AutomationReminders } from './automation/reminders';
import { AutomationLogs } from './automation/logs';

// Track L (D7) — default TCPA SMS opt-in disclosure (version 1). Re-exported here
// so the public surface of this module is unchanged (callers/tests that imported
// SMS_DISCLOSURE_V1 from 'automation.service' keep working).
export { SMS_DISCLOSURE_V1 };

/**
 * Automation engine — formerly a single ~744-LOC class. Split into focused mixins
 * under ./automation/ (core CRUD / trigger / conditions / sms / delivery /
 * reminders / logs) composed into one class here, so the public surface and every
 * `this`-call stay identical. The composition order encodes the dependency graph:
 * each mixin may call methods defined by an EARLIER mixin in the chain —
 *   Core (parseChannels) → Trigger (resolveAddress) → Conditions (evaluateConditions)
 *   → Sms (deliverSms) → Delivery (flush, uses evaluateConditions + deliverSms)
 *   → Reminders (uses parseChannels + resolveAddress) → Logs.
 *
 * Regulatory note: the TCPA SMS-consent flow lives intact in ./automation/sms.ts
 * (the consent gate and disclosure ledger must not change).
 *
 * Construction is positional and unchanged:
 *   new AutomationService(db, notification?, agreementService?, metering?)
 */
export class AutomationService extends AutomationLogs(
    AutomationReminders(
        AutomationDelivery(
            AutomationSms(
                AutomationConditions(
                    AutomationTrigger(
                        AutomationCore(AutomationBase),
                    ),
                ),
            ),
        ),
    ),
) {}
