import { describe, expect, it } from 'vitest';
import type { SmsConsentBlock } from '../../../server/lib/notifications/channel-consent';
import { projectSmsConsent, SMS_CONSENT_VIEW_FIELDS } from '../../../server/lib/notifications/sms-consent-view';

const BLOCK: SmsConsentBlock = {
    phone: '+15555550100', state: 'granted', at: '2026-01-02T03:04:05.000Z', capturedVia: 'booking_form', mode: 'express',
    subjects: [{ kind: 'contact', id: 'contact-1' }], disclosure: { version: 3, text: 'You agree to receive texts.' },
};

describe('the SMS consent block of the portal notification screen', () => {
    it('carries the fields the screen reads and not the contact rows it was read across', () => {
        const view = projectSmsConsent(BLOCK);
        expect(Object.keys(view ?? {}).sort()).toEqual([...SMS_CONSENT_VIEW_FIELDS].sort());
        expect(view).not.toHaveProperty('subjects');
        expect(view).toMatchObject({ phone: '+15555550100', state: 'granted', mode: 'express', disclosure: { version: 3 } });
        // Control: the block did hold them.
        expect(BLOCK.subjects).toHaveLength(1);
    });

    it('leaves a reader with no SMS identity as null', () => {
        expect(projectSmsConsent(null)).toBeNull();
    });
});
