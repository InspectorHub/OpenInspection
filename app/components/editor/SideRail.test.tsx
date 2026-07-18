import { render, screen } from '@testing-library/react';
import { SideRail } from '~/components/editor/SideRail';

test('fill mode shows the Photos tab', () => {
  render(<SideRail locale="en-US" mode="fill" initialOpen />);
  expect(screen.getByRole('button', { name: /Photos/ })).toBeTruthy();
});
test('author mode hides the Photos tab', () => {
  render(<SideRail locale="en-US" mode="author" initialOpen />);
  expect(screen.queryByRole('button', { name: /Photos/ })).toBeNull();
});
