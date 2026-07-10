import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { DefectCategoryEditor } from './DefectCategoryEditor';

test('edit mode seeds name + drivesSummary toggle', () => {
  const Stub = createRoutesStub([
    { path: '/library/defect-categories', Component: () => (
      <DefectCategoryEditor open onClose={() => {}} category={{ id: 'x', name: 'Safety', color: '#ef4444', drivesSummary: true, sortOrder: 2, isSeed: true }} />
    ) },
    { path: '/resources/defect-categories', action: async () => ({ ok: true }) },
  ]);
  render(<Stub initialEntries={['/library/defect-categories']} />);
  expect((screen.getByLabelText(/Name/i) as HTMLInputElement).value).toBe('Safety');
  expect((screen.getByLabelText(/Include in report Summary/i) as HTMLInputElement).checked).toBe(true);
});
