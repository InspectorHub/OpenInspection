// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { SideRail as BareSideRail } from "./SideRail";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";

const fake = createFakeDataSource({ data: createEmptyEditorData() });
/** The rail reads photo URLs and the photo gallery's data off the data source. */
function SideRail(props: Parameters<typeof BareSideRail>[0]) {
  return (
    <FieldDataSourceProvider dataSource={fake}>
      <BareSideRail {...props} />
    </FieldDataSourceProvider>
  );
}

test('fill mode shows the Photos tab', () => {
  render(<SideRail locale="en-US" mode="fill" initialOpen />);
  expect(screen.getByRole('button', { name: /Photos/ })).toBeTruthy();
});
test('author mode hides the Photos tab', () => {
  render(<SideRail locale="en-US" mode="author" initialOpen />);
  expect(screen.queryByRole('button', { name: /Photos/ })).toBeNull();
});
