import { describe, it, expect } from 'vitest';
import * as schema from '../../../server/lib/db/schema';

describe('Track L schema surface', () => {
    it('exposes the consent tables and new columns', () => {
        expect(schema.smsConsentLog).toBeDefined();
        expect(schema.smsDisclosureVersions).toBeDefined();
        expect(schema.automations.channels).toBeDefined();
        // SP2 — smsTemplateId (references a message_templates(channel='sms')
        // row) replaced the old free-text `automations.smsBody` column, which
        // is gone. This is the live column that selects what an SMS send says.
        expect(schema.automations.smsTemplateId).toBeDefined();
        expect(schema.automationLogs.recipient).toBeDefined();
        expect(schema.automationLogs.channel).toBeDefined();
        expect(schema.tenantConfigs.smsMode).toBeDefined();
    });
});
