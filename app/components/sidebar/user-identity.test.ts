import { describe, it, expect } from 'vitest';
import { userIdentity, roleLabel } from '~/components/sidebar/user-identity';

describe('userIdentity', () => {
  it('shows the name, with the email as the second line', () => {
    expect(userIdentity({ name: 'Dana Lee', email: 'dana@example.com' }, 'Unnamed')).toEqual({
      primary: 'Dana Lee',
      secondary: 'dana@example.com',
    });
  });

  it('shows the email once when there is no name', () => {
    expect(userIdentity({ name: '', email: 'dana@example.com' }, 'Unnamed')).toEqual({
      primary: 'dana@example.com',
      secondary: null,
    });
    expect(userIdentity({ name: '   ', email: 'dana@example.com' }, 'Unnamed')).toEqual({
      primary: 'dana@example.com',
      secondary: null,
    });
  });

  it('shows the email once when the name is the email', () => {
    expect(userIdentity({ name: 'Dana@Example.com', email: 'dana@example.com' }, 'Unnamed')).toEqual({
      primary: 'dana@example.com',
      secondary: null,
    });
  });

  it('falls back to the neutral word with no session', () => {
    expect(userIdentity(undefined, 'Unnamed')).toEqual({ primary: 'Unnamed', secondary: null });
    expect(userIdentity({ name: '', email: '' }, 'Unnamed')).toEqual({ primary: 'Unnamed', secondary: null });
  });
});

describe('roleLabel', () => {
  it('uses the translated team role names', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('inspector')).toBe('Inspector');
  });
  it('returns null for no role and echoes an unknown one', () => {
    expect(roleLabel(null)).toBeNull();
    expect(roleLabel(undefined)).toBeNull();
    expect(roleLabel('custom')).toBe('custom');
  });
});
