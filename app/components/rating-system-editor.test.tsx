import { render, screen, fireEvent } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { RatingSystemEditor } from './RatingSystemEditor';

test('onSaveLevels mode persists canonical levels without hitting the fetcher', () => {
  const onSaveLevels = vi.fn();
  const Stub = createRoutesStub([{ path: '/', Component: () => (
    <RatingSystemEditor open onClose={() => {}} onSaveLevels={onSaveLevels}
      system={{ id: 't', name: 'Tmpl', slug: 'tmpl', levels: [
        { abbreviation: 'S', label: 'Satisfactory', color: '#22c55e', severity: 'good', isDefect: false },
        { abbreviation: 'D', label: 'Defect', color: '#ef4444', severity: 'significant', isDefect: true },
      ] }} />
  ) }]);
  render(<Stub initialEntries={['/']} />);
  fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
  expect(onSaveLevels).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ abbreviation: 'D', severity: 'significant', isDefect: true }),
  ]));
});
