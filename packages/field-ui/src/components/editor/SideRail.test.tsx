// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { SideRail as BareSideRail } from "./SideRail";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeCommentsLibrary, createFakeDataSource, createFakeMediaPool } from "../../testing/fake-data-source";

// The rail lists what the host provides: the photo pool and the comment library.
const fake = createFakeDataSource({
  data: createEmptyEditorData(),
  resources: { mediaPool: createFakeMediaPool(), commentsLibrary: createFakeCommentsLibrary() },
});
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

// The results document stores a photo as an entry object, not a bare key. A video (no key) or a photo still waiting
// to upload has an empty key and nothing to show or download.
const ITEM = { id: 'i1', label: 'Flashing condition' };
test('the preview lists the photos of an item stored as entries, and skips an entry with no key', () => {
  const result = { photos: [{ key: 't/i/photo_a.jpg', mediaType: 'photo' }, { key: '', mediaType: 'video', streamUid: 'u1' }] };
  render(<SideRail locale="en-US" mode="fill" initialOpen activeItem={ITEM} activeResult={result} inspectionId="insp" />);
  expect(screen.getAllByRole('img')).toHaveLength(1);
});
test('CONTROL - bare keys are still listed', () => {
  render(<SideRail locale="en-US" mode="fill" initialOpen activeItem={ITEM} activeResult={{ photos: ['t/i/a.jpg', 't/i/b.jpg'] }} inspectionId="insp" />);
  expect(screen.getAllByRole('img')).toHaveLength(2);
});

test('the preview skips a null entry, an entry without a key and a video even when it has a key, and keeps a pending photo that has one', () => {
  const photos = [null, { mediaType: 'photo' }, { key: 't/i/p.jpg', pendingUpload: true, pendingId: 'p1' }, { key: 't/i/clip.mp4', mediaType: 'video' }];
  render(<SideRail locale="en-US" mode="fill" initialOpen activeItem={ITEM} activeResult={{ photos }} inspectionId="insp" />);
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.getByRole('img').getAttribute('loading')).toBe('lazy');
});

// In a bottom drawer the panel is the whole point of the drawer: the drawer's own close dismisses it, so the panel has no
// collapse control of its own and a tap on the active tab does not collapse it either (reopening showed an empty sheet).
test('fill: the panel has no close control and stays open when the active tab is tapped', () => {
  render(<SideRail locale="en-US" mode="fill" fill activeItem={ITEM} activeResult={{ photos: [] }} inspectionId="insp" />);
  expect(screen.queryByRole('button', { name: /close panel/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
  expect(screen.getByText('Flashing condition')).toBeTruthy();
});
test('CONTROL - without fill the panel closes with its control and again by tapping the active tab', () => {
  render(<SideRail locale="en-US" mode="fill" initialOpen activeItem={ITEM} activeResult={{ photos: [] }} inspectionId="insp" />);
  fireEvent.click(screen.getByRole('button', { name: /close panel/i }));
  expect(screen.queryByText('Flashing condition')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
  expect(screen.getByText('Flashing condition')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
  expect(screen.queryByText('Flashing condition')).toBeNull();
});

test('fill: tapping the active Library tab does not report the library closed while it is still showing', () => {
  const calls: boolean[] = [];
  const rich = { ...ITEM, type: 'rich' };
  render(<SideRail locale="en-US" mode="fill" fill activeItem={rich} activeResult={{ photos: [] }} inspectionId="insp" onLibraryTabChange={(open) => calls.push(open)} />);
  fireEvent.click(screen.getByRole('button', { name: /Library/ }));
  fireEvent.click(screen.getByRole('button', { name: /Library/ }));
  expect(calls).toEqual([true]);
});
test('CONTROL - without fill the second tap closes the library and says so', () => {
  const calls: boolean[] = [];
  const rich = { ...ITEM, type: 'rich' };
  render(<SideRail locale="en-US" mode="fill" activeItem={rich} activeResult={{ photos: [] }} inspectionId="insp" onLibraryTabChange={(open) => calls.push(open)} />);
  fireEvent.click(screen.getByRole('button', { name: /Library/ }));
  fireEvent.click(screen.getByRole('button', { name: /Library/ }));
  expect(calls).toEqual([true, false]);
});
