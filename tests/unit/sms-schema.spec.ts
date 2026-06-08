import { describe, it, expect } from 'vitest';
import * as schema from '../../server/lib/db/schema';

describe('Track L schema surface', () => {
    it('exposes the consent tables and new columns', () => {
        expect(schema.smsConsentLog).toBeDefined();
        expect(schema.smsDisclosureVersions).toBeDefined();
        expect(schema.automations.channels).toBeDefined();
        expect(schema.automations.smsBody).toBeDefined();
        expect(schema.automationLogs.recipient).toBeDefined();
        expect(schema.automationLogs.channel).toBeDefined();
        expect(schema.tenantConfigs.smsMode).toBeDefined();
    });
});
