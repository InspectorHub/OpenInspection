// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { MobileDrawer } from './MobileDrawer';

vi.mock('~/hooks/useSessionContext', () => ({
  useSessionContext: () => ({
    user: { name: 'Dana Lee', email: 'dana@example.com', role: 'inspector' },
    branding: { companyName: 'Acme Inspections', tenantSlug: 'acme-slug', logoUrl: '/logo.svg', isSaas: false },
  }),
  useCapabilities: () => null,
}));
vi.mock('~/components/LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('~/components/sidebar/ThemeSegmentControl', () => ({ ThemeSegmentControl: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MobileDrawer identity', () => {
  it('names the company once and shows the user, email and role without the slug', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addEventListener() {}, removeEventListener() {},
    }));
    render(<MemoryRouter><MobileDrawer open onClose={() => {}} /></MemoryRouter>);
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text.match(/Acme Inspections/g)).toHaveLength(1);
    expect(text).not.toContain('acme-slug');
    expect(text).toContain('Dana Lee');
    expect(text).toContain('dana@example.com');
    expect(text).toContain('Inspector');
  });
});
