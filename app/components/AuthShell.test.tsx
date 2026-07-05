import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AuthShell } from '~/components/AuthShell';

describe('AuthShell', () => {
  it('renders the heading and children', () => {
    const { getByRole, getByText } = render(
      <AuthShell heading="Reset your password">
        <button type="submit">Send reset link</button>
      </AuthShell>,
    );
    expect(getByRole('heading', { name: 'Reset your password' })).toBeTruthy();
    expect(getByRole('button', { name: 'Send reset link' })).toBeTruthy();
  });

  it('renders the subtitle when provided', () => {
    const { getByText } = render(
      <AuthShell heading="Check your inbox" subtitle="We sent you a link.">
        <span />
      </AuthShell>,
    );
    expect(getByText('We sent you a link.')).toBeTruthy();
  });

  it('omits the subtitle paragraph when not provided', () => {
    const { queryByText } = render(
      <AuthShell heading="Set a new password">
        <span />
      </AuthShell>,
    );
    expect(queryByText('We sent you a link.')).toBeNull();
  });

  it('renders the footer slot when provided', () => {
    const { getByText } = render(
      <AuthShell heading="Reset your password" footer={<a href="/login">Back to log in</a>}>
        <span />
      </AuthShell>,
    );
    expect(getByText('Back to log in')).toBeTruthy();
  });
});
