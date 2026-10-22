// @vitest-environment happy-dom
// Invariant: "Restore entire version" inside Compare unmounts Compare in the same
// commit that opens the confirm dialog. Cancel / Escape must return focus to the
// row's Compare button, but never steal focus the user moved elsewhere.
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

import { FieldDataSourceProvider } from '../../context';
import { createEmptyEditorData, createFakeDataSource, createFakeVersionHistory } from '../../testing/fake-data-source';
import { VersionHistoryPanel } from './VersionHistoryPanel';

const versionHistory = () => createFakeVersionHistory([{ seq: 2, atMs: Date.now() - 60_000, byUserId: null, reason: 'manual' }]);

async function settle() {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

async function openConfirmFromCompare() {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { versionHistory: versionHistory() } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <VersionHistoryPanel open onClose={() => {}} inspectionId="insp1" currentResults={{}} />
    </FieldDataSourceProvider>,
  );
  await settle();
  const compare = screen.getByText('Compare').closest('button') as HTMLButtonElement;
  compare.focus(); // a real click focuses the button; fireEvent does not
  fireEvent.click(compare);
  await settle();
  const restoreWhole = screen.getByText('Restore entire version') as HTMLButtonElement;
  restoreWhole.focus(); // the clicked button holds focus, then unmounts with Compare
  fireEvent.click(restoreWhole);
  await settle();
  return compare;
}

test('Cancel on the confirm returns focus to the Compare button that opened Compare', async () => {
  const compare = await openConfirmFromCompare();
  expect(screen.queryByText('Restore entire version')).toBeNull(); // Compare unmounted
  fireEvent.click(screen.getByText('Cancel'));
  await settle();
  expect(document.activeElement).toBe(compare);
});

test('Escape on the confirm returns focus to the Compare button', async () => {
  const compare = await openConfirmFromCompare();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await settle();
  expect(document.activeElement).toBe(compare);
});

test('control: focus the user moved elsewhere is not stolen', async () => {
  const compare = await openConfirmFromCompare();
  // Browsers treat body.focus() as a no-op; happy-dom blurs the active element.
  const bodyFocus = vi.spyOn(document.body, 'focus').mockImplementation(() => {});
  const other = document.createElement('input');
  document.body.appendChild(other);
  // Focus lands on another element at the moment Cancel is pressed.
  const cancel = screen.getByText('Cancel');
  cancel.addEventListener('click', () => other.focus(), { capture: true });
  fireEvent.click(cancel);
  await settle();
  expect(document.activeElement).toBe(other);
  expect(document.activeElement).not.toBe(compare);
  other.remove();
  bodyFocus.mockRestore();
});
