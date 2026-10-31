// @vitest-environment happy-dom
/**
 * A HEIC the host recognised but could not decode is skipped with one sentence from the host; the rest of the batch
 * is still uploaded. With keep original on, a HEIC the host can decode is converted (full size) and the rest is untouched.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import { DecodeImageError } from "../decode-image";
import type { FieldDataSource } from "../data-source";
import { m } from "../i18n";
import { ORIGINAL_QUALITY_KEY } from "../shared/original-quality";
import { createFakeDataSource } from "../testing/fake-data-source";
import { DATA, fullResources, fullSlots, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";

afterEach(() => {
  cleanup();
  localStorage.removeItem(ORIGINAL_QUALITY_KEY);
});

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const heic = (name: string) => new File([new Uint8Array([0, 0, 0, 16, ...text("ftypheic"), 0, 0, 0, 0])], name, { type: "image/heic" });
const jpeg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" });
const nameOf = (rec: { blob: Blob }) => (rec.blob as File).name;

async function pickBatch(withDecoder: boolean, files: File[], expectUploads = true) {
  localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
  stubViewport(true);
  const fake = createFakeDataSource({ data: DATA, session: { collabEditing: true, tenantSlug: null }, resources: fullResources(), online: true });
  const ds: FieldDataSource = {
    ...fake,
    media: {
      ...fake.media,
      ...(withDecoder
        ? {
            decodeImage: async (file: Blob) => {
              if ((file as File).name === "bad.heic") throw new DecodeImageError("UNSUPPORTED", "Install the HEIF codec.");
              return { blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }) };
            },
          }
        : {}),
    },
  };
  render(
    <FieldDataSourceProvider dataSource={ds} slots={fullSlots()}>
      <FieldEditor data={DATA} />
    </FieldDataSourceProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) }));
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await screen.findByRole("button", { name: m.editor_item_open_library() });
  fireEvent.change(document.querySelector('input[type="file"][multiple]') as HTMLInputElement, { target: { files } });
  if (expectUploads) await waitFor(() => expect(fake.uploads.length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 50));
  return { fake, uploaded: fake.uploads.map((u) => nameOf(u.rec)).sort() };
}

describe("a HEIC batch with a decoder", () => {
  it("one undecodable HEIC does not drop the other files, and the person hears why once", async () => {
    const { fake, uploaded } = await pickBatch(true, [heic("good.heic"), heic("bad.heic"), jpeg("c.jpg")]);
    expect(uploaded).toEqual(["c.jpg", "good.jpg"]);
    expect(fake.notifications.filter((x) => x.variant === "error")).toEqual([
      expect.objectContaining({ message: m.editor_route_photo_not_converted({ reason: "Install the HEIF codec." }) }),
    ]);
  });

  it("a batch where every file is skipped shows only the not-converted notices and sends nothing", async () => {
    const { fake, uploaded } = await pickBatch(true, [heic("bad.heic"), heic("bad.heic")], false);
    await new Promise((r) => setTimeout(r, 100));
    const reason = m.editor_route_photo_not_converted({ reason: "Install the HEIF codec." });
    expect(fake.notifications.map((x) => x.message)).toEqual([reason, reason]);
    expect(fake.notifications.map((x) => x.message)).not.toContain(m.editor_route_photo_upload_failed());
    expect([uploaded, fake.uploads.length]).toEqual([[], 0]);
  });

  it("CONTROL - without a decoder every file is uploaded as picked and nothing is reported", async () => {
    const { fake, uploaded } = await pickBatch(false, [heic("good.heic"), heic("bad.heic"), jpeg("c.jpg")]);
    expect(uploaded).toEqual(["bad.heic", "c.jpg", "good.heic"]);
    expect(fake.notifications.filter((x) => x.variant === "error")).toEqual([]);
  });
});
