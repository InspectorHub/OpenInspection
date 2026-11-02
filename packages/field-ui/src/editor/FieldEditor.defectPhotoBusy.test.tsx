// @vitest-environment happy-dom
/**
 * Adding a photo to a defect row while an earlier batch is still uploading. The upload queue takes further batches, so
 * the defect "add photo" chip must stay tappable (as the item's add tile does), each batch must reach its own defect,
 * and a picker that was opened for a defect and then cancelled must not send the next item-level pick to that defect.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import type { FieldDataSource, MediaUploader, PendingMediaRecord } from "../data-source";
import { m } from "../i18n";
import { ORIGINAL_QUALITY_KEY } from "../shared/original-quality";
import { createFakeDataSource } from "../testing/fake-data-source";
import { DATA, fullResources, fullSlots, stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  localStorage.removeItem(ORIGINAL_QUALITY_KEY);
});

const jpeg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), name], name, { type: "image/jpeg" });
const libraryInput = () => document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const TWO_DEFECTS = {
  ...DATA,
  schema: {
    sections: [
      {
        id: "s1",
        title: "Roofing",
        items: [
          {
            id: "i1",
            label: "Flashing condition",
            type: "rich" as const,
            tabs: {
              defects: [
                { id: "d1", title: "Granule loss", comment: "Granule loss at the eave." },
                { id: "d2", title: "Lifted flashing", comment: "Flashing lifted at the ridge." },
              ],
            },
          },
        ],
      },
    ],
  },
};

/** An editor whose uploader parks every upload until the test settles it, recording what each upload was for. */
async function openItem() {
  localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
  stubViewport(false);
  stubCamera(true);
  keepLabelsFromActivating();
  const fake = createFakeDataSource({ data: TWO_DEFECTS, session: { collabEditing: true, tenantSlug: null }, resources: fullResources(), online: true });
  const started: PendingMediaRecord[] = [];
  const settle: Array<(key: string) => void> = [];
  const uploader: MediaUploader = {
    upload: (rec) =>
      new Promise((resolve) => {
        started.push(rec);
        settle.push((key) => resolve({ ok: true, key }));
      }),
  };
  const ds: FieldDataSource = { ...fake, media: { ...fake.media, uploader: () => uploader } };
  render(
    <FieldDataSourceProvider dataSource={ds} slots={fullSlots()}>
      <FieldEditor data={TWO_DEFECTS} />
    </FieldDataSourceProvider>,
  );
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  const tab = (await screen.findAllByText("Defects")).find((el) => el.closest("button,[role=tab]"));
  fireEvent.click((tab ?? screen.getAllByText("Defects")[0]).closest("button,[role=tab]") ?? tab!);
  for (const box of await screen.findAllByRole("checkbox")) if (!(box as HTMLInputElement).checked) fireEvent.click(box);
  await screen.findAllByRole("button", { name: m.editor_item_add_defect_photo_aria() });
  return { started, settle };
}
/** Counts the times the library picker is asked to open (a real click on a file input opens nothing in the test DOM). */
function pickerOpens() {
  const count = { calls: 0 };
  libraryInput().addEventListener("click", () => { count.calls += 1; });
  return count;
}
/**
 * A real browser does not run a label's activation for a click on a button inside it; the test DOM does, which toggles
 * the defect's checkbox and removes the chip before the click reaches React. Cancelling the default first restores it.
 */
function keepLabelsFromActivating() {
  document.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }, true);
}
const chips = () => screen.getAllByRole("button", { name: m.editor_item_add_defect_photo_aria() });

describe("defect add-photo while a batch is uploading", () => {
  it("the chip stays tappable and opens the picker; the second batch goes to its own defect after the first", async () => {
    const { started, settle } = await openItem();
    const click = pickerOpens();
    // Batch 1 for defect 1.
    fireEvent.click(chips()[0]);
    expect(click.calls).toBe(1);
    fireEvent.change(libraryInput(), { target: { files: [jpeg("one")] } });
    await waitFor(() => expect(started).toHaveLength(1));
    // While it is out, the chip of defect 2 is not locked and opens the picker.
    expect(chips()[1].hasAttribute("disabled")).toBe(false);
    expect(chips()[1].getAttribute("aria-label")).toBe(m.editor_item_add_defect_photo_aria());
    fireEvent.click(chips()[1]);
    expect(click.calls).toBe(2);
    fireEvent.change(libraryInput(), { target: { files: [jpeg("two")] } });
    await flush();
    // The second batch waits for the first (the queue is serial), and carries its own defect.
    expect(started).toHaveLength(1);
    await act(async () => settle[0]("k-one"));
    await waitFor(() => expect(started).toHaveLength(2));
    await act(async () => settle[1]("k-two"));
    expect(started.map((r) => (r.meta as { customId?: string }).customId)).toEqual(["d1", "d2"]);
    expect(started.map((r) => (r.meta as { targetType: string }).targetType)).toEqual(["defect", "defect"]);
  });

  it("a picker opened for a defect and cancelled does not send the next item-level pick to that defect", async () => {
    const { started, settle } = await openItem();
    pickerOpens();
    fireEvent.click(chips()[0]);
    // The picker is cancelled: no change event. Then the item-level add tile is used.
    fireEvent.click(await screen.findByTestId("photo-add"));
    fireEvent.change(libraryInput(), { target: { files: [jpeg("item")] } });
    await waitFor(() => expect(started).toHaveLength(1));
    expect((started[0].meta as { targetType: string }).targetType).toBe("item");
    await act(async () => settle[0]("k"));
  });
});

describe("defect add-photo chip shows a busy cue while a batch uploads", () => {
  it("a spinner replaces the camera icon while a batch is out, the chip still opens the picker, and the icon returns after", async () => {
    const { started, settle } = await openItem();
    const click = pickerOpens();
    const spinners = () => chips().map((c) => c.querySelector('[data-testid="defect-photo-uploading"]'));
    expect(spinners()).toEqual([null, null]);
    fireEvent.click(chips()[0]);
    fireEvent.change(libraryInput(), { target: { files: [jpeg("one")] } });
    await waitFor(() => expect(started).toHaveLength(1));
    // Every defect chip of the item shows the cue (one queue serves the whole editor), each keeps its name and busy flag.
    await waitFor(() => expect(spinners().every((x) => x !== null)).toBe(true));
    for (const chip of chips()) {
      expect(chip.getAttribute("aria-busy")).toBe("true");
      expect(chip.getAttribute("aria-label")).toBe(m.editor_item_add_defect_photo_aria());
      expect(chip.querySelector('[data-testid="defect-photo-uploading"]')?.getAttribute("aria-hidden")).toBe("true");
      expect(chip.querySelectorAll("svg")).toHaveLength(1);
    }
    fireEvent.click(chips()[1]);
    expect(click.calls).toBe(2);
    await act(async () => settle[0]("k-one"));
    await waitFor(() => expect(spinners()).toEqual([null, null]));
    for (const chip of chips()) {
      expect(chip.hasAttribute("aria-busy")).toBe(false);
      expect(chip.querySelectorAll("svg")).toHaveLength(1);
    }
  });
});
