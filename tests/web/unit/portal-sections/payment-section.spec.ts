import { describe, it, expect } from 'vitest';
import { paymentSectionState } from '../../../../app/components/portal/sections/PaymentSection';

describe('PaymentSection paymentSectionState', () => {
  it('reflects paid/unpaid', () => {
    expect(paymentSectionState({ paymentStatus: 'paid' }).mode).toBe('paid');
    expect(paymentSectionState({ paymentStatus: 'unpaid', amountCents: 19999 }).mode).toBe('needs-payment');
  });

  it('treats invoice status:paid as paid', () => {
    expect(paymentSectionState({ status: 'paid' }).mode).toBe('paid');
  });

  it('void / draft with nothing owed → none', () => {
    expect(paymentSectionState({ status: 'void', amountCents: 5000 }).mode).toBe('none');
    expect(paymentSectionState({ status: 'draft', amountCents: 0 }).mode).toBe('none');
  });

  it('no invoice data → none', () => {
    expect(paymentSectionState({}).mode).toBe('none');
  });

  it('carries amountCents through', () => {
    expect(paymentSectionState({ paymentStatus: 'unpaid', amountCents: 19999 }).amountCents).toBe(19999);
  });
});
