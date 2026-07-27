import { describe, it, expect } from 'vitest';
import { reportUrl, signUrl, agreementSignUrl, agreementSignPath, checkoutUrl, embedBookingCompanyUrl, m2mAgreementRenderUrl, paymentUrl } from '../../../server/lib/public-urls';

describe('public URL builders', () => {
    it('uses http for localhost', () => {
        expect(embedBookingCompanyUrl('localhost:8788', 'acme')).toBe('http://localhost:8788/embed/acme');
    });
    it('reportUrl emits /report-view/<tenant>/<id> (canonical renderer)', () => {
        expect(reportUrl('app.example.com', 'acme', 'abc-123')).toBe('https://app.example.com/report-view/acme/abc-123');
    });
    it('signUrl emits /sign/<tenant>/<id>', () => {
        expect(signUrl('app.example.com', 'acme', 'abc-123')).toBe('https://app.example.com/sign/acme/abc-123');
    });
    it('agreementSignUrl emits /agreements/sign/<tenant>/<token>', () => {
        expect(agreementSignUrl('app.example.com', 'acme', 'tok-xyz')).toBe('https://app.example.com/agreements/sign/acme/tok-xyz');
    });
    it('agreementSignPath emits relative path', () => {
        expect(agreementSignPath('acme', 'tok-xyz')).toBe('/agreements/sign/acme/tok-xyz');
    });
    it('checkoutUrl emits /checkout/<tenant>/<token>', () => {
        expect(checkoutUrl('app.example.com', 'acme', 'tok-xyz')).toBe('https://app.example.com/checkout/acme/tok-xyz');
    });
    it('embedBookingCompanyUrl emits /embed/<tenant> (company-level)', () => {
        expect(embedBookingCompanyUrl('app.example.com', 'acme')).toBe('https://app.example.com/embed/acme');
    });
    // IA-34 — the public invoice page is token-gated, so the emailed pay link
    // MUST carry the recipient's portal token; a bare /invoice/:id is no longer
    // a credential.
    it('paymentUrl carries the recipient portal token as ?token=', () => {
        expect(paymentUrl('app.example.com', 'abc-123', 'tok+xyz/1'))
            .toBe('https://app.example.com/invoice/abc-123?token=tok%2Bxyz%2F1');
    });
    it('paymentUrl omits the query when no token is supplied', () => {
        expect(paymentUrl('app.example.com', 'abc-123')).toBe('https://app.example.com/invoice/abc-123');
    });
    it('m2mAgreementRenderUrl emits /m2m/agreement-render/<tenant>/<requestId>', () => {
        expect(m2mAgreementRenderUrl('app.example.com', 'acme', 'req-xyz')).toBe('https://app.example.com/m2m/agreement-render/acme/req-xyz');
    });
});
