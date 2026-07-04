import { describe, it, expect } from 'vitest';
import { agreementSectionState } from '../../../../app/components/portal/sections/AgreementSection';

describe('agreementSectionState', () => {
  it('reflects signed/unsigned', () => {
    expect(agreementSectionState({ signed: true }).mode).toBe('signed');
    expect(agreementSectionState({ signed: false, signUrl: '/agreements/x' }).mode).toBe('needs-signature');
  });

  it('maps signer.status signed → signed', () => {
    expect(agreementSectionState({ signer: { status: 'signed' } }).mode).toBe('signed');
  });

  it('maps signer.status declined → declined', () => {
    expect(agreementSectionState({ signer: { status: 'declined' } }).mode).toBe('declined');
  });

  it('returns none when there is no agreement to sign', () => {
    expect(agreementSectionState({}).mode).toBe('none');
    expect(agreementSectionState({ signed: false }).mode).toBe('none');
  });

  it('needs-signature when a pending signer has an agreement', () => {
    expect(agreementSectionState({ signer: { status: 'pending' }, signUrl: '/x' }).mode).toBe('needs-signature');
  });
});
