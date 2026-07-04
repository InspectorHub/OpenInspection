import { describe, it, expect } from 'vitest';
import { tabMatches } from '~/routes/inspections';

function insp(status: string, reportStatus = 'in_progress', paymentStatus?: string) {
  return { id: 'i1', date: null, address: null, clientName: null, status, reportStatus, paymentStatus };
}

describe('tabMatches — all', () => {
  it('always true', () => {
    expect(tabMatches('all', insp('requested'))).toBe(true);
    expect(tabMatches('all', insp('cancelled'))).toBe(true);
  });
});

describe('tabMatches — active (requested/scheduled/confirmed)', () => {
  it.each(['requested', 'scheduled', 'confirmed'])('matches %s', (s) => {
    expect(tabMatches('active', insp(s))).toBe(true);
  });
  it('does not match completed', () => {
    expect(tabMatches('active', insp('completed'))).toBe(false);
  });
  it('does not match cancelled', () => {
    expect(tabMatches('active', insp('cancelled'))).toBe(false);
  });
});

describe('tabMatches — requested', () => {
  it('matches requested', () => {
    expect(tabMatches('requested', insp('requested'))).toBe(true);
  });
  it('does not match scheduled', () => {
    expect(tabMatches('requested', insp('scheduled'))).toBe(false);
  });
});

describe('tabMatches — to_review', () => {
  it('matches submitted reportStatus', () => {
    expect(tabMatches('to_review', insp('completed', 'submitted'))).toBe(true);
  });
  it('does not match in_progress', () => {
    expect(tabMatches('to_review', insp('completed', 'in_progress'))).toBe(false);
  });
  it('does not match published', () => {
    expect(tabMatches('to_review', insp('completed', 'published'))).toBe(false);
  });
});

describe('tabMatches — published', () => {
  it('matches published reportStatus', () => {
    expect(tabMatches('published', insp('completed', 'published'))).toBe(true);
  });
  it('does not match in_progress', () => {
    expect(tabMatches('published', insp('completed', 'in_progress'))).toBe(false);
  });
});

describe('tabMatches — awaiting_payment', () => {
  it('published + unpaid → true', () => {
    expect(tabMatches('awaiting_payment', insp('completed', 'published', 'unpaid'))).toBe(true);
  });
  it('published + paid → false', () => {
    expect(tabMatches('awaiting_payment', insp('completed', 'published', 'paid'))).toBe(false);
  });
  it('in_progress + unpaid → false', () => {
    expect(tabMatches('awaiting_payment', insp('completed', 'in_progress', 'unpaid'))).toBe(false);
  });
});

describe('tabMatches — cancelled', () => {
  it('matches cancelled', () => {
    expect(tabMatches('cancelled', insp('cancelled'))).toBe(true);
  });
  it('does not match requested', () => {
    expect(tabMatches('cancelled', insp('requested'))).toBe(false);
  });
});
