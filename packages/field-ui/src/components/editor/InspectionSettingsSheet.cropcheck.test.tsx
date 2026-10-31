// @vitest-environment happy-dom
// The image check before a cover write is awaited, so it can outlast the click latch (which opens again one macrotask
// later). A second click in a LATER task must not start a second check or a second write, and a refused or failed
// check must leave the control usable.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { m } from "../../i18n";
import type { SettingsSheetData } from "../../data-source-types";
import { createEmptyEditorData, createFakeDataSource, createFakeSettingsSheet } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import { InspectionSettingsSheet } from "./InspectionSettingsSheet";

const refuse = vi.hoisted(() => ({ calls: 0, pending: [] as Array<(refused: boolean) => void>, fail: [] as Array<(e: Error) => void> }));
vi.mock("../../hooks/photo-save-guard", () => ({
  refuseInadmissibleImage: () => {
    refuse.calls += 1;
    return new Promise<boolean>((resolve, reject) => { refuse.pending.push(resolve); refuse.fail.push(reject); });
  },
}));
const photoCheck = vi.hoisted(() => ({ calls: 0, pending: [] as Array<(r: string | null) => void>, fail: [] as Array<(e: Error) => void> }));
vi.mock("../../shared/photo-admission", async (orig) => ({
  ...(await orig<typeof import("../../shared/photo-admission")>()),
  photoRefusal: () => {
    photoCheck.calls += 1;
    return new Promise<string | null>((resolve, reject) => { photoCheck.pending.push(resolve); photoCheck.fail.push(reject); });
  },
}));
vi.mock("../media-studio/CoverCropper", () => ({
  coverCropFor: () => null,
  CoverCropper: ({ onSave }: { onSave: (b: Blob, c: unknown) => void }) => (
    <button type="button" data-testid="crop-save" onClick={() => onSave(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]), { aspect: "1:1", orientation: "landscape", pixels: { x: 0, y: 0, width: 1, height: 1 } })}>save crop</button>
  ),
}));

beforeEach(() => {
  refuse.calls = 0;
  refuse.pending = [];
  refuse.fail = [];
  photoCheck.calls = 0;
  photoCheck.pending = [];
  photoCheck.fail = [];
});
afterEach(cleanup);
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

const DATA: SettingsSheetData = {
  inspection: { templateId: "t1" },
  templates: [{ id: "t1", name: "Full" }],
  photos: [{ key: "k1", url: "/p/k1.jpg", label: "front" }],
  profiles: [{ id: "signature", name: "Signature" }],
};

function mount(): FakeDataSource {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { settingsSheet: createFakeSettingsSheet(DATA) } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <InspectionSettingsSheet open onClose={() => {}} inspectionId="insp-1" />
    </FieldDataSourceProvider>,
  );
  return fake;
}
const types = (fake: FakeDataSource) => fake.commands.map((c) => c.cmd.type);
const cropSave = () => document.querySelector('[data-testid="crop-save"]') as HTMLButtonElement | null;
async function openCropper() {
  await waitFor(() => expect(document.querySelector('img[alt="front"]')).not.toBeNull());
  act(() => { (document.querySelector('img[alt="front"]')!.closest("button") as HTMLButtonElement).click(); });
  await waitFor(() => expect(cropSave()).not.toBeNull());
  return cropSave()!;
}

describe("cover crop save while the image check is out", () => {
  it("a second Save in a later task starts no second check and no second write, and the cropper stays closed", async () => {
    const fake = mount();
    const save = await openCropper();
    act(() => { save.click(); });
    await tick();
    act(() => { save.click(); });
    await tick();
    expect(refuse.calls).toBe(1);
    await act(async () => { refuse.pending[0]!(false); });
    await tick();
    expect(types(fake)).toEqual(["crop-cover"]);
    expect(cropSave()).toBeNull();
  });

  it("CONTROL - a refused check leaves the cropper open and the next Save runs a new check", async () => {
    const fake = mount();
    const save = await openCropper();
    act(() => { save.click(); });
    await act(async () => { refuse.pending[0]!(true); });
    await tick();
    expect(cropSave()).not.toBeNull();
    act(() => { cropSave()!.click(); });
    await tick();
    expect(refuse.calls).toBe(2);
    await act(async () => { refuse.pending[1]!(false); });
    await tick();
    expect(types(fake)).toEqual(["crop-cover"]);
  });
});

describe("a check that throws", () => {
  it("crop: says the save failed and leaves the cropper usable", async () => {
    const fake = mount();
    const save = await openCropper();
    act(() => { save.click(); });
    await act(async () => { refuse.fail[0]!(new Error("unreadable: secret detail")); });
    await tick();
    expect(fake.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_failed()]);
    expect(JSON.stringify(fake.notifications)).not.toContain("secret detail");
    expect(types(fake)).toEqual([]);
    act(() => { cropSave()!.click(); });
    await tick();
    expect(refuse.calls).toBe(2);
  });

  it("upload: says the save failed and stops showing the upload as running", async () => {
    const fake = mount();
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "a.png", { type: "image/png" })], configurable: true });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { photoCheck.fail[0]!(new Error("unreadable")); });
    await tick();
    expect(fake.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_failed()]);
    expect(types(fake)).toEqual([]);
  });
});

describe("cover upload while the photo check is out", () => {
  it("a second pick in a later task starts no second check and no second upload", async () => {
    const fake = mount();
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pick = (name: string) => {
      Object.defineProperty(input, "files", { value: [new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/png" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    act(() => { pick("a.png"); });
    await tick();
    act(() => { pick("b.png"); });
    await tick();
    expect(photoCheck.calls).toBe(1);
    await act(async () => { photoCheck.pending[0]!(null); });
    await tick();
    expect(types(fake)).toEqual(["upload-cover"]);
  });
});
