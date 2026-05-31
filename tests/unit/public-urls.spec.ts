import { describe, it, expect } from 'vitest';
import { bookingUrl, inspectorProfileUrl, inspectorCalendarUrl, reportUrl, signUrl, agreementSignUrl, agreementSignPath, embedBookingUrl, m2mAgreementRenderUrl } from '../../src/lib/public-urls';

describe('public URL builders', () => {
    it('bookingUrl emits /book/<tenant>/<inspector>', () => {
        expect(bookingUrl('app.example.com', 'acme', 'jane')).toBe('https://app.example.com/book/acme/jane');
    });
    it('uses http for localhost', () => {
        expect(bookingUrl('localhost:8788', 'acme', 'jane')).toBe('http://localhost:8788/book/acme/jane');
    });
    it('reportUrl emits /report/<tenant>/<id>', () => {
        expect(reportUrl('app.example.com', 'acme', 'abc-123')).toBe('https://app.example.com/report/acme/abc-123');
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
    it('inspectorProfileUrl emits /inspector/<tenant>/<slug>', () => {
        expect(inspectorProfileUrl('app.example.com', 'acme', 'jane')).toBe('https://app.example.com/inspector/acme/jane');
    });
    it('inspectorCalendarUrl emits /inspector/<tenant>/<slug>/calendar.ics', () => {
        expect(inspectorCalendarUrl('app.example.com', 'acme', 'jane')).toBe('https://app.example.com/inspector/acme/jane/calendar.ics');
    });
    it('embedBookingUrl emits /embed/book/<tenant>/<slug>', () => {
        expect(embedBookingUrl('app.example.com', 'acme', 'jane')).toBe('https://app.example.com/embed/book/acme/jane');
    });
    it('m2mAgreementRenderUrl emits /m2m/agreement-render/<tenant>/<token>', () => {
        expect(m2mAgreementRenderUrl('app.example.com', 'acme', 'tok-xyz')).toBe('https://app.example.com/m2m/agreement-render/acme/tok-xyz');
    });
});
