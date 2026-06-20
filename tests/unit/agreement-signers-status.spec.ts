import { describe, it, expect } from 'vitest';
import { computeEnvelopeStatus } from '../../server/services/agreement.service';

describe('computeEnvelopeStatus', () => {
    it('all + [signed,signed] -> signed', () => {
        expect(computeEnvelopeStatus('all', [{ status: 'signed' }, { status: 'signed' }])).toBe('signed');
    });
    it('all + [signed,pending] -> viewed', () => {
        expect(computeEnvelopeStatus('all', [{ status: 'signed' }, { status: 'pending' }])).toBe('viewed');
    });
    it('all + [declined,signed] -> declined', () => {
        expect(computeEnvelopeStatus('all', [{ status: 'declined' }, { status: 'signed' }])).toBe('declined');
    });
    it('one + [signed,pending] -> signed', () => {
        expect(computeEnvelopeStatus('one', [{ status: 'signed' }, { status: 'pending' }])).toBe('signed');
    });
    it('one + [declined,pending] -> pending', () => {
        expect(computeEnvelopeStatus('one', [{ status: 'declined' }, { status: 'pending' }])).toBe('pending');
    });
    it('one + [declined,declined] -> declined', () => {
        expect(computeEnvelopeStatus('one', [{ status: 'declined' }, { status: 'declined' }])).toBe('declined');
    });
    it('[] -> pending', () => {
        expect(computeEnvelopeStatus('all', [])).toBe('pending');
    });
    it('all + [sent,pending] -> sent', () => {
        expect(computeEnvelopeStatus('all', [{ status: 'sent' }, { status: 'pending' }])).toBe('sent');
    });
    it('all + [sent,sent] -> sent', () => {
        expect(computeEnvelopeStatus('all', [{ status: 'sent' }, { status: 'sent' }])).toBe('sent');
    });
});
