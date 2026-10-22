// @vitest-environment happy-dom
/**
 * F57 — the photo drawer said "No photos in this inspection yet." on an
 * inspection that had photos.
 *
 * There were two causes, and they are fixed in two places.
 *
 * The first is server-side and is covered by `tests/unit/media/media-center.spec.ts`:
 * `inspection_results` is unique per REPORT, and the media query read one
 * arbitrary row, so the drawer could answer about a sibling document while the
 * item strip and the tab badge read the one that was open.
 *
 * The second is here. The panel had one empty state doing the work of three: a
 * load in flight, a load that failed, and an inspection that genuinely has no
 * photos all arrived as `photos.length === 0`, and all three printed a claim
 * about the inspection. These tests pin which message each state gets, because
 * the distinction is the fix — a retry is useless on a page that has already
 * told the inspector their photos are not there.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { FieldResources } from "../../data-source";
import type { MediaPoolListing } from "../../data-source-types";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { PhotoGallery } from "./PhotoGallery";

const PHOTOS = [
  { key: "a.jpg", url: "/p/a.jpg?w=480", label: "Roof Covering" },
  { key: "b.jpg", url: "/p/b.jpg?w=480", label: "Service Panel" },
];

const EMPTY_CLAIM = /No photos in this inspection yet/;

/** Mount the gallery on a data source whose pool answers through `list` (a host with no pool when it is absent). */
function renderGallery(list?: (inspectionId: string) => Promise<MediaPoolListing> | MediaPoolListing) {
  const resources: FieldResources = list ? { mediaPool: { list: async (id) => list(id) } } : {};
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources });
  return render(
    <FieldDataSourceProvider dataSource={fake}>
      <PhotoGallery inspectionId="i1" onSetCover={() => {}} onAnnotate={() => {}} />
    </FieldDataSourceProvider>,
  );
}

describe("PhotoGallery", () => {
  it("never claims the inspection is empty while the answer is still in flight", async () => {
    renderGallery(() => new Promise<MediaPoolListing>(() => {})); // never resolves
    expect(await screen.findByText(/Loading photos/)).toBeTruthy();
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
  });

  it("shows the photos the pool returns", async () => {
    renderGallery(() => ({ photos: PHOTOS, answered: true }));
    // The grid measures itself before painting, so assert on the absence of the
    // three text states rather than on rendered <img> tags, which need layout.
    await vi.waitFor(() => {
      expect(screen.queryByText(/Loading photos/)).toBeNull();
    });
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
    expect(screen.queryByText(/Photos could not be loaded/)).toBeNull();
  });

  it("offers a retry when the load failed, instead of claiming there are none", async () => {
    renderGallery(() => ({ photos: [], answered: false }));

    expect(await screen.findByText(/Photos could not be loaded/)).toBeTruthy();
    // The whole point: a failure must not be reported as a fact about the
    // inspection's contents.
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("retry re-asks the pool, and succeeds when the answer arrives", async () => {
    let calls = 0;
    renderGallery(() => {
      calls += 1;
      return calls === 1 ? { photos: [], answered: false } : { photos: PHOTOS, answered: true };
    });

    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    await vi.waitFor(() => {
      expect(screen.queryByText(/Photos could not be loaded/)).toBeNull();
    });
    expect(calls).toBeGreaterThan(1);
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
  });

  it("says the inspection has no photos only when the pool answered and said so", async () => {
    renderGallery(() => ({ photos: [], answered: true }));
    expect(await screen.findByText(EMPTY_CLAIM)).toBeTruthy();
  });

  it("asks for the photos of the inspection it was given, and offers a retry on a host with no pool", async () => {
    const asked: string[] = [];
    renderGallery((id) => {
      asked.push(id);
      return { photos: [], answered: true };
    });
    expect(await screen.findByText(EMPTY_CLAIM)).toBeTruthy();
    expect(asked).toEqual(["i1"]);

    renderGallery();
    expect((await screen.findAllByText(/Photos could not be loaded/)).length).toBe(1);
  });
});
