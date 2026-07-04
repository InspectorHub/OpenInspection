import { describe, it, expect } from 'vitest';
import { bookingUrl, reportUrl, signUrl, agreementSignUrl, agreementSignPath, checkoutUrl, embedBookingUrl, embedBookingCompanyUrl, m2mAgreementRenderUrl } from '../../../server/lib/public-urls';

describe('public URL builders', () => {
    it('bookingUrl emits /book/<tenant>/<inspector>', () => {
        expect(bookingUrl('app.example.com', 'acme', 'jane')).toBe('https://app.example.com/book/acme/jane');
    });
    it('uses http for localhost', () => {
        expect(bookingUrl('localhost:8788', 'acme', 'jane')).toBe('http://localhost:8788/book/acme/jane');
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
    it('embedBookingUrl emits /embed/<tenant>/<slug> (real route, not /embed/book/)', () => {
        expect(embedBookingUrl('app.example.com', 'acme', 'jane')).toBe('https://app.example.com/embed/acme/jane');
    });
    it('embedBookingCompanyUrl emits /embed/<tenant> (company-level, IA-26)', () => {
        expect(embedBookingCompanyUrl('app.example.com', 'acme')).toBe('https://app.example.com/embed/acme');
    });
    it('m2mAgreementRenderUrl emits /m2m/agreement-render/<tenant>/<requestId>', () => {
        expect(m2mAgreementRenderUrl('app.example.com', 'acme', 'req-xyz')).toBe('https://app.example.com/m2m/agreement-render/acme/req-xyz');
    });
});
