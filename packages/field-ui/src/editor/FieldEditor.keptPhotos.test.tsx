// @vitest-environment happy-dom
/**
 * A photo the host kept on the device (`kept`) is not a failure: the editor shows one neutral notice, never the red
 * failure toasts, and the save state does not go to error. A real failure keeps its red toasts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import type { FieldDataSource } from "../data-source";
import { m } from "../i18n";
import { ORIGINAL_QUALITY_KEY } from "../shared/original-quality";
import { createFakeDataSource } from "../testing/fake-data-source";
import { DATA, fullResources, fullSlots, stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";

const frames = vi.hoisted(() => ({ count: 2 }));
vi.mock("../components/editor/BurstCamera", () => ({
  BurstCamera: ({ onCommit }: { onCommit: (blobs: Blob[]) => void }) => (
    <button
      data-testid="burst-commit"
      onClick={() => onCommit(Array.from({ length: frames.count }, () => new Blob(["frame"], { type: "image/jpeg" })))}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  localStorage.removeItem(ORIGINAL_QUALITY_KEY);
});

type Answer = { ok: true; key: string } | { ok: false; error: string; kept?: true };

/** A phone editor whose uploader answers the files of one burst in order; returns what the editor announced. */
async function commitBurst(answers: Answer[]) {
  localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
  frames.count = answers.length;
  stubViewport(true);
  stubCamera(true);
  const fake = createFakeDataSource({ data: DATA, session: { collabEditing: true, tenantSlug: null }, resources: fullResources() });
  let n = 0;
  const ds: FieldDataSource = {
    ...fake,
    media: { ...fake.media, uploader: () => ({ upload: async () => answers[n++] ?? { ok: false as const, error: "EXTRA" } }) },
  };
  render(
    <FieldDataSourceProvider dataSource={ds} slots={fullSlots()}>
      <FieldEditor data={DATA} />
    </FieldDataSourceProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) }));
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await screen.findByRole("button", { name: m.editor_item_open_library() });
  fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
  fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_burst_camera() }));
  fireEvent.click(screen.getByTestId("burst-commit"));
  await waitFor(() => expect(fake.notifications.length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 50));
  const sent = fake.notifications.map((x) => ({ message: x.message, variant: x.variant }));
  return { sent, messages: sent.map((x) => x.message), variantOf: (msg: string) => sent.find((x) => x.message === msg)?.variant };
}

describe("photos kept on the device", () => {
  it("a batch of only kept photos shows the neutral notice and none of the red ones", async () => {
    const kept = { ok: false as const, error: "HTTP_500", kept: true as const };
    const out = await commitBurst([kept, kept]);
    const notice = m.editor_route_photos_kept({ count: 2, s: "s" });
    expect(out.messages).toContain(notice);
    expect(out.variantOf(notice)).toBe("info");
    expect(out.messages).not.toContain(m.editor_route_save_failed());
    expect(out.sent.filter((x) => x.variant === "error")).toEqual([]);
  });

  it("a mixed batch shows the red failure notice and the neutral one", async () => {
    const out = await commitBurst([{ ok: false, error: "HTTP_500", kept: true }, { ok: false, error: "HTTP_500" }]);
    const kept = m.editor_route_photos_kept({ count: 1, s: "" });
    const partial = m.editor_route_photos_partial_upload({ success: 0, total: 1, failed: 1 });
    expect(out.messages).toContain(kept);
    expect(out.messages).toContain(partial);
    expect(out.messages).toContain(m.editor_route_save_failed());
    expect(out.variantOf(kept)).toBe("info");
    expect(out.variantOf(partial)).toBe("error");
  });

  it("CONTROL - a real failure without kept keeps the red toasts and has no neutral notice", async () => {
    const out = await commitBurst([{ ok: false, error: "HTTP_500" }, { ok: false, error: "HTTP_500" }]);
    expect(out.messages).toContain(m.editor_route_photos_partial_upload({ success: 0, total: 2, failed: 2 }));
    expect(out.messages).toContain(m.editor_route_save_failed());
    expect(out.variantOf(m.editor_route_save_failed())).toBe("error");
    expect(out.sent.filter((x) => x.variant === "info")).toEqual([]);
  });

  it("a known oversized upload shows its fixed reason instead of a generic count", async () => {
    const out = await commitBurst([{ ok: false, error: "TOO_LARGE" }]);
    const tooLarge = m.editor_route_photo_too_large_single();
    expect(out.messages).toContain(tooLarge);
    expect(out.messages).not.toContain(m.editor_route_photos_partial_upload({ success: 0, total: 1, failed: 1 }));
    expect(out.variantOf(tooLarge)).toBe("error");
  });

  it("CONTROL - a clean batch shows only the success notice", async () => {
    const out = await commitBurst([{ ok: true, key: "k1" }, { ok: true, key: "k2" }]);
    expect(out.variantOf(m.editor_route_photos_added({ count: 2, s: "s", toDefect: "" }))).toBe("success");
    expect(out.sent.filter((x) => x.variant === "error" || x.variant === "info")).toEqual([]);
  });
});
