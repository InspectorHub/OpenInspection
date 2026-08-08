// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { CommentEditor } from './CommentEditor';

function renderEditor(comment: React.ComponentProps<typeof CommentEditor>['comment'] = null) {
  const Stub = createRoutesStub([
    { path: '/library/comments', Component: () => (
      <CommentEditor open onClose={() => {}} comment={comment} contractorTypes={[]} />
    ) },
    { path: '/resources/comments-library', action: async () => ({ ok: true }) },
  ]);
  return render(<Stub initialEntries={['/library/comments']} />);
}

test('create mode shows an empty text field and a severity selector', () => {
  renderEditor();
  expect((screen.getByLabelText(/Comment text/i) as HTMLTextAreaElement).value).toBe('');
  expect(screen.getByLabelText(/Severity/i)).toBeTruthy();
  // Repair fields hidden until severity = Defect
  expect(screen.queryByLabelText(/Repair summary/i)).toBeNull();
});

test('edit mode seeds fields from the comment and reveals repair fields for a defect', () => {
  renderEditor({ id: 'c1', text: 'Cracked', section: 'Roof', severity: 'significant', repairSummary: 'Replace' });
  expect((screen.getByLabelText(/Comment text/i) as HTMLTextAreaElement).value).toBe('Cracked');
  expect((screen.getByLabelText(/Repair summary/i) as HTMLInputElement).value).toBe('Replace');
});

/**
 * A canned comment describes what was observed and what it takes to put it
 * right. It does not carry a price: the number a reader sees on a report is
 * attributed to the company whose name is on it, and the product has no way to
 * know this property, this trade market, or this week. Money on an inspection
 * is written by the buyer or their agent, in the repair request.
 *
 * The assertion is on the CONTROL, not on a label string: a renamed label with
 * the input still there is the same capability. `MoneyInput` is the single
 * money-entry control in the app (see app/components/MoneyInput.tsx), and it is
 * the only thing that renders `inputmode="decimal"` here.
 */
test('a defect comment offers repair scope but no money entry', () => {
  const { container } = renderEditor({
    id: 'c1', text: 'Cracked', section: 'Roof', severity: 'significant', repairSummary: 'Replace',
  });
  // The scope field is still there — this is not "the defect panel went away".
  expect(screen.getByLabelText(/Repair summary/i)).toBeTruthy();
  expect(container.querySelectorAll('input[inputmode="decimal"]')).toHaveLength(0);
  expect(screen.queryByLabelText(/Est\./i)).toBeNull();
});
