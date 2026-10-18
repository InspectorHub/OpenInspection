// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Sidebar } from '~/components/Sidebar';

let user: { name: string; email: string; role: string } = { name: 'Dana Lee', email: 'dana@example.com', role: 'inspector' };

vi.mock('~/hooks/useSessionContext', () => ({
  useSessionContext: () => ({
    user,
    branding: { companyName: 'Acme Inspections', tenantSlug: 'acme-slug', logoUrl: '/logo.svg', isSaas: false },
  }),
  useCapabilities: () => null,
  useUnreadMessages: () => 0,
}));
vi.mock('~/components/CommandPalette', () => ({ useCommandPalette: () => ({ openPalette: () => {} }) }));
vi.mock('~/components/notices/StaffNoticeBell', () => ({ StaffNoticeBell: () => null }));
vi.mock('~/components/LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('~/components/sidebar/ThemeSegmentControl', () => ({ ThemeSegmentControl: () => null }));

function mount() {
  const router = createMemoryRouter([{ id: 'root', path: '/', element: <Sidebar /> }], {
    hydrationData: { loaderData: { root: { sidebarCollapsed: false } } },
  });
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  document.cookie = 'oi-sidebar=; Max-Age=0';
});

describe('Sidebar identity row', () => {
  it('shows the name and the role, not the company slug or the company again', () => {
    user = { name: 'Dana Lee', email: 'dana@example.com', role: 'inspector' };
    mount();
    const trigger = screen.getByTestId('user-menu-trigger');
    expect(trigger.textContent).toContain('Dana Lee');
    expect(trigger.textContent).toContain('Inspector');
    expect(trigger.textContent).not.toContain('acme-slug');
    expect(trigger.textContent).not.toContain('Acme Inspections');
    expect(trigger.getAttribute('title')).toContain('dana@example.com');
  });

  it('the opened menu names the user, the email and the role, and never the slug', () => {
    user = { name: 'Dana Lee', email: 'dana@example.com', role: 'owner' };
    mount();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    const card = screen.getByTestId('user-menu-identity');
    expect(card.textContent).toContain('Dana Lee');
    expect(card.textContent).toContain('dana@example.com');
    expect(card.textContent).toContain('Owner');
    expect(card.textContent).not.toContain('acme-slug');
    expect(card.textContent).not.toContain('Acme Inspections');
  });

  it('shows the email once when the name is the email', () => {
    user = { name: 'dana@example.com', email: 'dana@example.com', role: 'staff' };
    mount();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    const card = screen.getByTestId('user-menu-identity');
    expect(card.textContent?.match(/dana@example\.com/g)).toHaveLength(1);
  });
});

describe('Sidebar collapse toggle', () => {
  it('is always visible: no opacity-0 / hover-only classes', () => {
    user = { name: 'Dana Lee', email: 'dana@example.com', role: 'owner' };
    mount();
    const btn = screen.getByTestId('sidebar-collapse-toggle');
    expect(btn.className).not.toContain('opacity-0');
    expect(btn.className).not.toContain('-right-');
  });

  it('sits between Library and Settings and flips the sidebar', () => {
    user = { name: 'Dana Lee', email: 'dana@example.com', role: 'owner' };
    mount();
    const btn = screen.getByTestId('sidebar-collapse-toggle');
    const library = document.querySelector('a[href="/library"]')!;
    const settings = document.querySelector('a[href="/settings"]')!;
    const after = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(library, btn) || after(btn, library)).toBe(true);
    expect(after(btn, settings)).toBe(true);
    // The label names the action, so it flips with the state; no aria-expanded on top of it (it would be read twice).
    expect(btn.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(btn.hasAttribute('aria-expanded')).toBe(false);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toBe('Expand sidebar');
    expect(screen.queryByText('WORKSPACE')).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toBe('Collapse sidebar');
  });
});
