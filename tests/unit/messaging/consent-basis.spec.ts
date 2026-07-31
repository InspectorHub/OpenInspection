import { describe, it, expect } from 'vitest';
import {
    CONSENT_BASIS_BY_KIND,
    requiresExpressSmsConsent,
} from '../../../server/lib/sms/consent-basis';

/**
 * A3.2 — every RoleKind has an explicit express/implied basis. Absence of a
 * rule must never decide; `other` is business counterparties (D5), not a
 * silent allow.
 */
describe('CONSENT_BASIS_BY_KIND', () => {
    it('client is express; agent and other are implied', () => {
        expect(CONSENT_BASIS_BY_KIND.client.basis).toBe('express');
        expect(CONSENT_BASIS_BY_KIND.agent.basis).toBe('implied');
        expect(CONSENT_BASIS_BY_KIND.other.basis).toBe('implied');
        expect(CONSENT_BASIS_BY_KIND.other.rationale.toLowerCase()).toMatch(/attorney|title|business/);
    });

    it('requiresExpressSmsConsent mirrors the express basis', () => {
        expect(requiresExpressSmsConsent('client')).toBe(true);
        expect(requiresExpressSmsConsent('agent')).toBe(false);
        expect(requiresExpressSmsConsent('other')).toBe(false);
    });

    it('recipient_type vocabulary matches RoleKind 1:1', () => {
        expect(CONSENT_BASIS_BY_KIND.client.recipientType).toBe('client');
        expect(CONSENT_BASIS_BY_KIND.agent.recipientType).toBe('agent');
        expect(CONSENT_BASIS_BY_KIND.other.recipientType).toBe('other');
    });
});
