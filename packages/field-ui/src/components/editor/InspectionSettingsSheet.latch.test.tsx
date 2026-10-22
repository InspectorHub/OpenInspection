// @vitest-environment happy-dom
// Every write the sheet makes (the settings save and the three cover writes) goes through `useFieldCommand`, whose
// guard is taken synchronously. The pending button only goes inert after a render, which is too late for a second
// event in the same frame (a duplicate photo in the pool, a doubled save), so each trigger below is fired twice in
// ONE act() with raw events, and a later trigger must still go through.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { SettingsSheetData } from "../../data-source-types";
import { createEmptyEditorData, createFakeDataSource, createFakeSettingsSheet } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import { InspectionSettingsSheet } from "./InspectionSettingsSheet";

// The real cropper needs canvas; a stub that just exposes onSave is enough to reach the write.
vi.mock("../media-studio/CoverCropper", () => ({
  coverCropFor: () => null,
  CoverCropper: ({ onSave }: { onSave: (b: Blob, c: unknown) => void }) => (
    <button type="button" data-testid="crop-save" onClick={() => onSave(new Blob(["x"]), { aspect: "1:1", orientation: "landscape", pixels: { x: 0, y: 0, width: 1, height: 1 } })}>save crop</button>
  ),
}));

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const DATA: SettingsSheetData = {
  inspection: { templateId: "t1" },
  templates: [{ id: "t1", name: "Full" }],
  photos: [{ key: "k1", url: "/p/k1.jpg", label: "front" }],
  profiles: [{ id: "signature", name: "Signature" }],
};

function mount(data: SettingsSheetData = DATA): FakeDataSource {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { settingsSheet: createFakeSettingsSheet(data) } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <InspectionSettingsSheet open onClose={() => {}} inspectionId="insp-1" />
    </FieldDataSourceProvider>,
  );
  return fake;
}

const types = (fake: FakeDataSource) => fake.commands.map((c) => c.cmd.type);

describe("InspectionSettingsSheet cover upload latch", () => {
  it("uploads ONCE for two same-frame picks, and again after the first upload settles", async () => {
    const fake = mount();
    fake.failExecute("upload-cover", "no");
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    // Raw dispatch: fireEvent wraps each call in its own act(), which would flush between the two.
    const pick = (name: string) => {
      Object.defineProperty(input, "files", { value: [new File(["x"], name, { type: "image/png" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    act(() => { pick("a.png"); pick("b.png"); });
    await settle();
    expect(types(fake)).toEqual(["upload-cover"]);

    act(() => { pick("c.png"); });
    await settle();
    expect(types(fake)).toEqual(["upload-cover", "upload-cover"]);
  });

  it("saves the crop ONCE for two same-frame saves, and again after the first settles", async () => {
    const fake = mount();
    fake.failExecute("crop-cover", "no");
    const openCropper = async () => {
      await waitFor(() => expect(document.querySelector('img[alt="front"]')).not.toBeNull());
      act(() => { (document.querySelector('img[alt="front"]')!.closest("button") as HTMLButtonElement).click(); });
      await waitFor(() => expect(document.querySelector('[data-testid="crop-save"]')).not.toBeNull());
      return document.querySelector('[data-testid="crop-save"]') as HTMLButtonElement;
    };
    const save1 = await openCropper();
    act(() => { save1.click(); save1.click(); });
    await settle();
    expect(types(fake)).toEqual(["crop-cover"]);

    const save2 = await openCropper();
    act(() => { save2.click(); });
    await settle();
    expect(types(fake)).toEqual(["crop-cover", "crop-cover"]);
  });
});

describe("InspectionSettingsSheet clear-cover latch", () => {
  const COVERED: SettingsSheetData = { ...DATA, inspection: { templateId: "t1", coverPhotoId: "k1" } };
  const tile = () => document.querySelector('img[alt="front"]')!.closest("button") as HTMLButtonElement;
  const isSelected = () => tile().className.includes("border-ih-primary") && !tile().className.includes("hover:border-ih-primary/60");

  it("two same-frame clicks on the selected cover clear it ONCE and leave it cleared (no restore from the repeat)", async () => {
    const fake = mount(COVERED);
    await waitFor(() => expect(document.querySelector('img[alt="front"]')).not.toBeNull());
    expect(isSelected()).toBe(true);

    // Raw clicks in ONE act(): the repeat's closure still sees the old cover.
    act(() => { tile().click(); tile().click(); });
    await settle();
    expect(types(fake)).toEqual(["set-cover"]);
    expect(isSelected()).toBe(false);
  });

  it("a later click on the now-unselected cover still goes through (opens the cropper)", async () => {
    mount(COVERED);
    await waitFor(() => expect(document.querySelector('img[alt="front"]')).not.toBeNull());
    act(() => { tile().click(); });
    await settle();
    act(() => { tile().click(); });
    await waitFor(() => expect(document.querySelector('[data-testid="crop-save"]')).not.toBeNull());
  });
});

describe("InspectionSettingsSheet save guard", () => {
  const submit = () => {
    const form = document.getElementById("inspection-settings-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

  it("sends ONE save-settings for two same-frame submits, and another for a later one", async () => {
    const fake = mount();
    await waitFor(() => expect(document.getElementById("inspection-settings-form")).not.toBeNull());
    act(() => { submit(); submit(); });
    await settle();
    expect(types(fake)).toEqual(["save-settings"]);

    act(() => { submit(); });
    await settle();
    expect(types(fake)).toEqual(["save-settings", "save-settings"]);
  });

  it("a cover write and a save are separate guards: both go through in one frame", async () => {
    const fake = mount();
    await waitFor(() => expect(document.getElementById("inspection-settings-form")).not.toBeNull());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.png", { type: "image/png" })], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      submit();
    });
    await settle();
    expect(types(fake).sort()).toEqual(["save-settings", "upload-cover"]);
  });
});
