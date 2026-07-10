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
