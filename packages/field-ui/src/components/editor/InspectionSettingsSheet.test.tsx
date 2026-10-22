// @vitest-environment happy-dom
/**
 * The settings sheet on a fake data source: what it reads when it opens, the `save-settings` payload and what the
 * answer drives (the pill, `onTemplateApplied`), the cover writes, and the host that cannot read the sheet.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, waitFor, screen, fireEvent } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { SettingsSheetData } from "../../data-source-types";
import { createEmptyEditorData, createFakeDataSource, createFakeSettingsSheet } from "../../testing/fake-data-source";
import type { FakeDataSource, FakeSettingsSheet } from "../../testing/fake-data-source";
import { InspectionSettingsSheet } from "./InspectionSettingsSheet";

vi.mock("../media-studio/CoverCropper", () => ({
  coverCropFor: () => null,
  CoverCropper: ({ onSave }: { onSave: (b: Blob, c: unknown) => void }) => (
    <button type="button" data-testid="crop-save" onClick={() => onSave(new Blob(["x"]), { aspect: "3:2", orientation: "landscape", pixels: { x: 1, y: 2, width: 30, height: 20 } })}>save crop</button>
  ),
}));

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const DATA: SettingsSheetData = {
  inspection: { templateId: "t1", requireDefectFieldsOverride: "trade", profileOverride: "", coverPhotoId: "k1" },
  templates: [{ id: "t1", name: "Full" }, { id: "t2", name: "Condo" }],
  photos: [{ key: "k1", url: "/p/k1.jpg", label: "front" }, { key: "k2", url: "/p/k2.jpg", label: "back" }],
  profiles: [{ id: "signature", name: "Signature" }, { id: "meridian", name: "Meridian" }],
};

function mount(sheet: FakeSettingsSheet, extra: { onTemplateApplied?: () => void } = {}): FakeDataSource {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { settingsSheet: sheet } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <InspectionSettingsSheet open onClose={() => {}} inspectionId="insp-1" {...extra} />
    </FieldDataSourceProvider>,
  );
  return fake;
}
const form = () => document.getElementById("inspection-settings-form") as HTMLFormElement;
const save = () => fireEvent.submit(form());

describe("InspectionSettingsSheet", () => {
  it("reads the sheet for its inspection and fills the form and the appearance list from it", async () => {
    const sheet = createFakeSettingsSheet(DATA);
    mount(sheet);
    await waitFor(() => expect(form()).not.toBeNull());
    expect(sheet.loads).toEqual(["insp-1"]);
    expect((screen.getByTestId("inspection-require-defect-fields") as unknown as HTMLSelectElement).value).toBe("trade");
    const options = [...(screen.getByTestId("inspection-profile-override") as unknown as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toContain("Meridian");
  });

  it("sends the form as save-settings with '' as an explicit null, and reports saved", async () => {
    const fake = mount(createFakeSettingsSheet(DATA));
    await waitFor(() => expect(form()).not.toBeNull());
    save();
    await waitFor(() => expect(fake.commands).toHaveLength(1));
    expect(fake.commands[0]!.cmd).toEqual({
      type: "save-settings",
      payload: { templateId: "t1", requireDefectFieldsOverride: "trade", profileOverride: null },
    });
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  it("calls onTemplateApplied only when the template changed and the save was accepted", async () => {
    const onTemplateApplied = vi.fn();
    const fake = mount(createFakeSettingsSheet(DATA), { onTemplateApplied });
    await waitFor(() => expect(form()).not.toBeNull());
    save();
    await settle();
    expect(onTemplateApplied).not.toHaveBeenCalled();

    // Open the template picker (its trigger shows the current template) and pick the other one.
    fireEvent.click(screen.getByRole("button", { name: "Full" }));
    fireEvent.click(await screen.findByRole("button", { name: "Condo" }));
    fake.failExecute("save-settings", "refused");
    save();
    await waitFor(() => expect(screen.getByText(/Error/)).toBeTruthy());
    expect(onTemplateApplied).not.toHaveBeenCalled();

    // The host recovers: the retry lands and the template switch is announced once.
    const recovered = createFakeDataSource({ data: createEmptyEditorData() });
    vi.spyOn(fake, "execute").mockImplementation(recovered.execute);
    save();
    await waitFor(() => expect(onTemplateApplied).toHaveBeenCalledTimes(1));
  });

  it("shows the error pill, not 'saved', when the save is refused", async () => {
    const fake = mount(createFakeSettingsSheet(DATA));
    fake.failExecute("save-settings", "no");
    await waitFor(() => expect(form()).not.toBeNull());
    save();
    await waitFor(() => expect(screen.getByText(/Error/)).toBeTruthy());
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("offers a retry, and no save button, when the host could not read the sheet", async () => {
    const sheet = createFakeSettingsSheet(null);
    mount(sheet);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(form()).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    sheet.setData(DATA);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(form()).not.toBeNull());
    expect(sheet.loads).toEqual(["insp-1", "insp-1"]);
  });

  it("clearing the selected cover sends set-cover with an empty id", async () => {
    const fake = mount(createFakeSettingsSheet(DATA));
    await waitFor(() => expect(form()).not.toBeNull());
    fireEvent.click(document.querySelector('img[alt="front"]')!.closest("button")!);
    await settle();
    expect(fake.commands.map((c) => c.cmd)).toEqual([{ type: "set-cover", coverPhotoId: "" }]);
    // The selection badge is gone.
    expect(screen.queryByText("Cover")).toBeNull();
  });

  it("a cropped cover is sent as crop-cover with the serialised crop and an image file", async () => {
    const fake = mount(createFakeSettingsSheet(DATA));
    await waitFor(() => expect(form()).not.toBeNull());
    fireEvent.click(document.querySelector('img[alt="back"]')!.closest("button")!);
    fireEvent.click(await screen.findByTestId("crop-save"));
    await settle();
    const cmd = fake.commands[0]!.cmd;
    expect(cmd.type).toBe("crop-cover");
    if (cmd.type !== "crop-cover") return;
    expect(cmd.sourceKey).toBe("k2");
    expect(JSON.parse(cmd.crop)).toEqual({ aspect: "3:2", orientation: "landscape", x: 1, y: 2, width: 30, height: 20 });
    expect((cmd.image as File).name).toBe("cover.jpg");
  });

  it("an uploaded cover joins the grid and opens for cropping", async () => {
    const fake = mount(createFakeSettingsSheet(DATA));
    fake.respondWith("upload-cover", { coverKey: "k9", coverUrl: "/p/k9.jpg" });
    await waitFor(() => expect(form()).not.toBeNull());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.png", { type: "image/png" })], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByTestId("crop-save")).toBeTruthy();
    expect(document.querySelector('img[src="/p/k9.jpg"]')).not.toBeNull();
  });
});
