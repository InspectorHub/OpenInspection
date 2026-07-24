import { render, screen, fireEvent } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { CommandPalette } from './CommandPalette';

// IA-50 — the per-group render cap of 8 silently hid 6 of the Settings
// destinations whenever the palette was browsed without a filter word. The cap
// is gone; every static navigation destination must be reachable both by
// browsing and by typing a keyword.
function renderPalette() {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <CommandPalette open onOpenChange={() => {}} /> },
    { path: '/resources/recent-inspections', loader: () => ({ inspections: [] }) },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

test('browsing with no filter word renders every Settings destination, not just the first 8', async () => {
  renderPalette();
  // These four all sort past the old cap-of-8 in the Settings group, so under
  // the old truncation they never rendered without a query.
  expect(await screen.findByText('Settings - QuickBooks')).toBeTruthy();
  expect(screen.getByText('Settings - Payments')).toBeTruthy();
  expect(screen.getByText('Settings - AI')).toBeTruthy();
  expect(screen.getByText('Settings - Data Import / Export')).toBeTruthy();
});

test('the newly added static entries are reachable by keyword', async () => {
  renderPalette();
  const input = await screen.findByPlaceholderText(/search/i);

  fireEvent.change(input, { target: { value: 'QuickBooks' } });
  expect(screen.getByText('Settings - QuickBooks')).toBeTruthy();

  fireEvent.change(input, { target: { value: 'Email Templates' } });
  expect(screen.getByText('Settings - Email Templates')).toBeTruthy();
});

// Per-inspector booking deep links are retired: an inspector shares the
// company booking page, and the server auto-assigns. The palette's
// copy-booking-link action must offer that company URL, not the removed
// `/book/<tenant>/<slug>` path form.
function renderPaletteAsInspector() {
  const Stub = createRoutesStub([
    {
      id: 'routes/auth-layout',
      path: '/',
      Component: () => <CommandPalette open onOpenChange={() => {}} />,
      loader: () => ({
        context: {
          branding: {
            tenantSlug: 'acme',
            currentUserSlug: 'jane',
            bookingHost: 'app.example.com',
          },
        },
      }),
    },
    { path: '/resources/recent-inspections', loader: () => ({ inspections: [] }) },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

test('copy-booking-link offers the company booking URL, not the retired per-inspector path', async () => {
  renderPaletteAsInspector();
  expect(await screen.findByText('https://app.example.com/book/acme')).toBeTruthy();
  expect(screen.queryByText('https://app.example.com/book/acme/jane')).toBeNull();
});
