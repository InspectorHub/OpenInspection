// @vitest-environment happy-dom
/**
 * Delete in the photo viewer asks first. It used to remove the photo the moment the button was pressed. The viewer is
 * replaced by a stand-in whose Delete reports the photo it is showing; what is under test is what the editor does with it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { m } from "../i18n";
import { appendPhoto, projectResults } from "../shared/results-doc";
import type { GalleryPhoto } from "../shared/inspection-media";
import { mountForRatings } from "./FieldEditor.rating.fixtures";

const SHOWN = vi.hoisted((): GalleryPhoto => ({ key: "a1.jpg", url: "/t/a1", label: "A", itemId: "i1", sectionId: "s1", photoIndex: 1, originalKey: "a1.jpg" }));

vi.mock("../components/media-studio/MediaViewer", async (importOriginal) => {
  const real = await importOriginal<typeof import("../components/media-studio/MediaViewer")>();
  return {
    ...real,
    MediaViewer: ({ onAction }: { onAction: (a: string, p: GalleryPhoto) => void }) => (
      <button type="button" data-testid="viewer-delete" onClick={() => onAction("delete", SHOWN)}>delete shown</button>
    ),
  };
});

afterEach(cleanup);
const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const keys = (h: Awaited<ReturnType<typeof mount>>) => (projectResults(h.doc())["_default:s1:i1"]?.photos ?? []).map((p) => (typeof p === "string" ? p : p.key));

async function mount() {
  const h = mountForRatings(1280);
  await screen.findByRole("button", { name: m.editor_header_publish() });
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]!);
  await waitFor(() => expect(() => h.doc()).not.toThrow());
  appendPhoto(h.doc(), "_default:s1:i1", { key: "a0.jpg", mediaType: "photo" });
  appendPhoto(h.doc(), "_default:s1:i1", { key: "a1.jpg", mediaType: "photo" });
  await tick();
  return h;
}

describe("viewer Delete", () => {
  it("asks first, and deletes nothing until it is confirmed", async () => {
    const h = await mount();
    fireEvent.click(screen.getByTestId("viewer-delete"));
    await tick();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(m.media_delete_photo_title())).toBeTruthy();
    expect(keys(h)).toEqual(["a0.jpg", "a1.jpg"]);
  });

  it("Cancel leaves the photo", async () => {
    const h = await mount();
    fireEvent.click(screen.getByTestId("viewer-delete"));
    fireEvent.click(await screen.findByRole("button", { name: m.common_cancel() }));
    await tick();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(keys(h)).toEqual(["a0.jpg", "a1.jpg"]);
  });

  it("Escape leaves the photo", async () => {
    const h = await mount();
    fireEvent.click(screen.getByTestId("viewer-delete"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await tick();
    expect(keys(h)).toEqual(["a0.jpg", "a1.jpg"]);
  });

  it("confirming deletes the photo that was shown, and only that one, once", async () => {
    const h = await mount();
    fireEvent.click(screen.getByTestId("viewer-delete"));
    const confirm = await screen.findByRole("button", { name: m.common_delete() });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // a second press in the same frame
    await tick(120);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(keys(h)).toEqual(["a0.jpg"]);
  });
});
