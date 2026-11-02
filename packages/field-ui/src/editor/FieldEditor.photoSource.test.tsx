// @vitest-environment happy-dom
/**
 * Where a photo came from. The host gets only a Blob in the pending record, so the editor says whether the photo was
 * taken now (camera input, burst camera) or picked from the library, in `meta.source`. A host that copies new photos
 * to the device gallery needs it: a library photo is already there. The field is set online and offline.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import { m } from "../i18n";
import { ORIGINAL_QUALITY_KEY } from "../shared/original-quality";
import { createFakeDataSource } from "../testing/fake-data-source";
import { DATA, fullResources, fullSlots, stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";

vi.mock("../components/editor/BurstCamera", () => ({
  BurstCamera: ({ onCommit }: { onCommit: (blobs: Blob[]) => void }) => (
    <button data-testid="burst-commit" onClick={() => onCommit([new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })])} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  localStorage.removeItem(ORIGINAL_QUALITY_KEY);
});

const jpeg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" });
const cameraInput = () => document.querySelector('input[type="file"][capture]') as HTMLInputElement;
const libraryInput = () => document.querySelector('input[type="file"][multiple]') as HTMLInputElement;

async function openItem(online: boolean) {
  localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
  stubViewport(true);
  stubCamera(true);
  const fake = createFakeDataSource({ data: DATA, session: { collabEditing: true, tenantSlug: null }, resources: fullResources(), online });
  render(
    <FieldDataSourceProvider dataSource={fake} slots={fullSlots()}>
      <FieldEditor data={DATA} />
    </FieldDataSourceProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) }));
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await screen.findByRole("button", { name: m.editor_item_open_library() });
  return fake;
}

describe("meta.source on an uploaded photo", () => {
  it("the camera input says camera", async () => {
    const fake = await openItem(true);
    fireEvent.change(cameraInput(), { target: { files: [jpeg("cam.jpg")] } });
    await waitFor(() => expect(fake.uploads).toHaveLength(1));
    expect(fake.uploads[0].rec.meta).toMatchObject({ targetType: "item", source: "camera" });
  });

  it("the library input says library, for every file of the pick", async () => {
    const fake = await openItem(true);
    fireEvent.change(libraryInput(), { target: { files: [jpeg("a.jpg"), jpeg("b.jpg")] } });
    await waitFor(() => expect(fake.uploads).toHaveLength(2));
    expect(fake.uploads.map((u) => (u.rec.meta as { source?: string }).source)).toEqual(["library", "library"]);
  });

  it("the burst camera says burst", async () => {
    const fake = await openItem(true);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_burst_camera() }));
    fireEvent.click(screen.getByTestId("burst-commit"));
    await waitFor(() => expect(fake.uploads).toHaveLength(1));
    expect(fake.uploads[0].rec.meta).toMatchObject({ targetType: "item", source: "burst" });
  });

  it("the offline pending record keeps the origin too (camera and library)", async () => {
    const fake = await openItem(false);
    fireEvent.change(cameraInput(), { target: { files: [jpeg("cam.jpg")] } });
    fireEvent.change(libraryInput(), { target: { files: [jpeg("lib.jpg")] } });
    await waitFor(async () => expect(await fake.media.store.list("insp-1")).toHaveLength(2));
    const sources = (await fake.media.store.list("insp-1")).map((r) => (r.meta as { source?: string }).source).sort();
    expect(sources).toEqual(["camera", "library"]);
  });
});
