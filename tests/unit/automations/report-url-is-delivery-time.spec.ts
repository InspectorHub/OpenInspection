/**
 * The report link is built where the message is DELIVERED, not where it is
 * triggered — and that is why `TriggerContext` carries no base URL.
 *
 * A `reportBaseUrl` sat on the trigger shape and was read by nothing. Four call
 * sites passed `c.env.APP_BASE_URL`, three passed `''`, and the difference never
 * showed anywhere, because the variable templates actually use is built at
 * delivery from the base URL the cron job resolves from `env` at that moment.
 *
 * That timing is the point, not an accident of layering. A trigger writes an
 * `automation_logs` row and can sit there for hours; the address the mail goes
 * out under is a property of the deployment sending it, not of the request that
 * queued it. Capturing it at trigger time would freeze a value that the
 * delivery is entitled to re-read.
 *
 * These cases exist because deleting the unused field leaves an absence, and an
 * absence explains nothing on its own. They pin what replaces it.
 */
import { describe, it, expect } from 'vitest';

import { reportUrl } from '../../../server/lib/public-urls';
import { AUTOMATION_SEEDS } from '../../../server/data/automation-seeds';
import type { TriggerContext } from '../../../server/services/automation/shared';

describe('the report link is a delivery-time value', () => {
    it('is built from the host it is given, not from anything on the trigger', () => {
        const url = reportUrl('app.example.com', 'acme', 'insp-1');
        expect(url).toContain('app.example.com');
        expect(url).toContain('acme');
        expect(url).toContain('insp-1');
    });

    /**
     * POSITIVE CONTROL. A builder that ignored its host argument would satisfy
     * the assertion above whenever the fixture host happened to appear in the
     * template — two different deployments must produce two different links.
     */
    it('changes when the deployment address changes', () => {
        expect(reportUrl('a.example.com', 'acme', 'insp-1'))
            .not.toBe(reportUrl('b.example.com', 'acme', 'insp-1'));
    });

    /**
     * And the variable is genuinely consumed: the shipped Report Ready seed
     * links to it from both the email body and the SMS. Without this, the two
     * cases above would only prove a URL helper works.
     */
    it('is referenced by the seed templates that announce a report', () => {
        // The seeds are a heterogeneous readonly tuple — only some carry an
        // `smsBody` — so both fields are read as optional rather than asserted
        // onto every member.
        const users = AUTOMATION_SEEDS.filter((entry) => {
            const seed = entry as { bodyTemplate?: string; smsBody?: string };
            return (seed.bodyTemplate ?? '').includes('{{report_url}}')
                || (seed.smsBody ?? '').includes('{{report_url}}');
        });
        expect(users.length).toBeGreaterThan(0);
    });

    /**
     * The trigger shape says nothing about addresses. A compile-time assertion
     * rather than a runtime one, because the failure this guards against is
     * somebody RE-ADDING the field, and by the time a test could observe a value
     * the type has already accepted it.
     */
    it('leaves the trigger context with no base-url field', () => {
        const ctx: TriggerContext = {
            tenantId: 't1',
            inspectionId: 'i1',
            triggerEvent: 'report.published',
            companyName: 'Acme',
        };
        expect(Object.keys(ctx)).not.toContain('reportBaseUrl');
        // POSITIVE CONTROL: an empty object would satisfy that on its own.
        expect(Object.keys(ctx)).toContain('companyName');
    });
});
