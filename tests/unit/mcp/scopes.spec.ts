import { describe, it, expect } from 'vitest';
import { roleAllowedScopeKinds, computeGrantedScopes } from '../../../server/lib/mcp/scopes';

describe('roleAllowedScopeKinds', () => {
  it('owner/manager get read/write/admin', () => {
    expect(roleAllowedScopeKinds('manager').sort()).toEqual(['admin','read','write']);
  });
  it('inspector gets read/write only', () => {
    expect(roleAllowedScopeKinds('inspector').sort()).toEqual(['read','write']);
  });
  it('agent gets read/agent only', () => {
    expect(roleAllowedScopeKinds('agent').sort()).toEqual(['agent','read']);
  });
});

describe('computeGrantedScopes', () => {
  it('intersects requested ∩ selected and caps by role', () => {
    const out = computeGrantedScopes({
      requested: ['read:inspections','write:inspections','admin:team'],
      selected:  ['write:inspections','admin:team'],
      role: 'inspector', // admin not allowed
    });
    expect(out.sort()).toEqual(['read:inspections','write:inspections']);
  });
  it('write implies read for the same tag', () => {
    const out = computeGrantedScopes({ requested: ['write:bookings'], selected: ['write:bookings'], role: 'manager' });
    expect(out.sort()).toEqual(['read:bookings','write:bookings']);
  });
  it('drops anything not both requested and selected', () => {
    const out = computeGrantedScopes({ requested: ['read:inspections'], selected: ['read:bookings'], role: 'manager' });
    expect(out).toEqual([]);
  });
});
