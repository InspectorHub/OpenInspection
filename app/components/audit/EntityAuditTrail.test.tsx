import { render, screen, fireEvent } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { EntityAuditTrail, type AuditEntry } from './EntityAuditTrail';

// IA-64 — the disclosure must stay collapsed until opened, then lazy-load the
// entity's audit trail and surface "Last edited by X" plus the full history.
function renderTrail(entries: AuditEntry[]) {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <EntityAuditTrail entityId="tmpl-1" timeZone="UTC" /> },
    { path: '/resources/entity-audit', loader: () => ({ entries }) },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

const ENTRIES: AuditEntry[] = [
  { id: 'a2', action: 'template.update', actorId: 'u1', actorName: 'Ed Editor', createdAt: 1_700_000_200_000 },
  { id: 'a1', action: 'template.create', actorId: 'u1', actorName: 'Ed Editor', createdAt: 1_700_000_100_000 },
];

test('history is collapsed by default and reveals attribution on open', async () => {
  renderTrail(ENTRIES);
  // Collapsed: the trail body is not rendered yet.
  expect(screen.queryByText(/Last edited by/)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /history/i }));

  // Latest actor surfaces as the headline, and both history rows render.
  expect(await screen.findByText(/Last edited by Ed Editor/)).toBeTruthy();
  expect(screen.getByText('Created')).toBeTruthy();
  expect(screen.getByText('Updated')).toBeTruthy();
});

test('shows an empty state when the entity has no recorded changes', async () => {
  renderTrail([]);
  fireEvent.click(screen.getByRole('button', { name: /history/i }));
  expect(await screen.findByText('No recorded changes yet.')).toBeTruthy();
});
