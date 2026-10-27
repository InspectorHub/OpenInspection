// @vitest-environment happy-dom
/**
 * A read-only editor reads: navigation, the rating as an indicator, notes as text, photos and their viewer, the preview,
 * and updates that arrive from other people. Nothing in it writes: no local transaction on the results document, no
 * command, no upload, no store write; and none of the controls that would write is in the page.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { FieldDataSourceProvider, useFieldCommand } from "../context";
import { m } from "../i18n";
import { ReadOnlyScope } from "../read-only";
import { loadResultsProjection } from "../shared/results-doc";
import type { ResultsProjection } from "../shared/results-doc.types";
import { createFakeDataSource, createEmptyEditorData } from "../testing/fake-data-source";
import { stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";
import { mountForRatings, RATING_DATA } from "./FieldEditor.rating.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const SEEN: ResultsProjection = {
  "_default:s1:i1": { rating: "def", notes: "Granule loss at the eave.", photos: [{ key: "t/insp-1/a.jpg", mediaType: "photo" }] },
} as ResultsProjection;

/** Delivers `projection` to the editor's document the way another person's edit arrives (a remote update). */
function deliver(doc: Y.Doc, projection: ResultsProjection) {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  loadResultsProjection(other, projection);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), "remote");
}

async function mountSeen(readOnly: boolean, width = 1280) {
  const h = mountForRatings(width, { readOnly });
  await screen.findAllByText("Flashing condition");
  await waitFor(() => h.doc());
  let local = 0;
  h.doc().on("afterTransaction", (tr: Y.Transaction) => { if (tr.local) local += 1; });
  deliver(h.doc(), SEEN);
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  return { h, local: () => local };
}

const PRESSES = ["1", "2", "3", "4", "5", "0", "n", "N", "r", "R", "p", "s", "z", "t", "/"] as const;

describe("readOnly editor: reading works", () => {
  it("shows the rating as an indicator and the notes as text, from an update that arrived from someone else", async () => {
    await mountSeen(true);
    expect((await screen.findByTestId("read-only-rating")).textContent).toBe("Defect");
    expect(screen.getByTestId("read-only-notes").textContent).toBe("Granule loss at the eave.");
  });

  it("lists the photo and opens the viewer on a tap, without any viewer action", async () => {
    await mountSeen(true);
    fireEvent.click(await screen.findByTestId("thumb-0"));
    await waitFor(() => expect(document.querySelector(".yarl__root")).not.toBeNull());
    expect(screen.queryByRole("button", { name: m.media_viewer_caption() })).toBeNull();
  });

  it("navigates to another item and a later remote change shows up", async () => {
    const { h } = await mountSeen(true);
    fireEvent.click((await screen.findAllByText("Gutter condition"))[0]);
    expect(await screen.findByRole("heading", { name: "Gutter condition" })).toBeTruthy();
    deliver(h.doc(), { ...SEEN, "_default:s1:i2": { rating: "ok" } } as ResultsProjection);
    expect((await screen.findByTestId("read-only-rating")).textContent).toBe("Satisfactory");
  });

  it("CONTROL - the same editor not read-only offers the rating row and a notes input", async () => {
    await mountSeen(false);
    expect(await screen.findByRole("radiogroup", { name: m.editor_rating_aria() })).toBeTruthy();
    expect(document.getElementById("notes-textarea")).not.toBeNull();
  });
});

describe("readOnly editor: no write control is offered", () => {
  it.each([["desktop", 1280], ["tablet", 834], ["phone", 390]] as const)("%s: none of the write controls is in the page", async (_tree, width) => {
    await mountSeen(true, width);
    await screen.findByTestId("read-only-item");
    const absent: Record<string, Element | null> = {
      rating: screen.queryByRole("radiogroup", { name: m.editor_rating_aria() }),
      notes: document.getElementById("notes-textarea"),
      addPhoto: screen.queryByTestId("photo-add"),
      publish: screen.queryByTestId("editor-publish-btn"),
      tabletPublish: screen.queryByTestId("tablet-publish-btn"),
      speed: screen.queryByTestId("speed-entry"),
      sign: screen.queryByRole("button", { name: m.editor_header_sign() }),
      settings: screen.queryByRole("button", { name: m.editor_header_settings() }),
      addSection: screen.queryByRole("button", { name: m.editor_shared_add_section() }),
      batch: screen.queryByRole("button", { name: m.editor_route_batch_select_items() }),
    };
    expect(Object.entries(absent).filter(([, el]) => el !== null).map(([name]) => name)).toEqual([]);
  });

  it("CONTROL - the not-read-only desktop editor has them", async () => {
    await mountSeen(false);
    await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
    expect(screen.queryByTestId("editor-publish-btn")).not.toBeNull();
    expect(screen.queryByRole("button", { name: m.editor_shared_add_section() })).not.toBeNull();
    expect(screen.queryByRole("button", { name: m.editor_route_batch_select_items() })).not.toBeNull();
  });
});

describe("readOnly editor: nothing is written", () => {
  it("rating keys, clear, N/A, clone, photo, save, speed and the rest write nothing", async () => {
    const { h, local } = await mountSeen(true);
    await screen.findByTestId("read-only-item");
    for (const key of PRESSES) {
      fireEvent.keyDown(document.body, { key });
      fireEvent.keyDown(document.body, { key, ctrlKey: true });
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(local()).toBe(0);
    expect(h.fake.commands).toEqual([]);
    expect(h.fake.uploads).toEqual([]);
    expect(screen.queryByRole("dialog", { name: m.editor_speedmode_aria_label() })).toBeNull();
    expect((await screen.findByTestId("read-only-rating")).textContent).toBe("Defect");
  });

  it("a photo file handed to the hidden picker is dropped: no upload, no store write, no notice", async () => {
    const { h, local } = await mountSeen(true);
    await screen.findByTestId("read-only-item");
    const put = vi.spyOn(h.fake.media.store, "put");
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.fake.uploads).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    expect(local()).toBe(0);
    expect(h.fake.notifications).toEqual([]);
  });

  it("CONTROL - the not-read-only editor does write on the same keys", async () => {
    const { local } = await mountSeen(false);
    await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
    fireEvent.keyDown(document.body, { key: "2" });
    await waitFor(() => expect(local()).toBeGreaterThan(0));
  });
});

describe("readOnly editor: a command is refused with a visible message", () => {
  function Probe({ onResult }: { onResult: (r: unknown) => void }) {
    const { run } = useFieldCommand("insp-1");
    return <button onClick={() => void run({ type: "save-pca-narrative", key: "k", value: "v" } as never).then(onResult)}>go</button>;
  }

  async function press(readOnly: boolean) {
    const fake = createFakeDataSource({ data: createEmptyEditorData(RATING_DATA) });
    const result: unknown[] = [];
    render(
      <FieldDataSourceProvider dataSource={fake}>
        <ReadOnlyScope readOnly={readOnly}>
          <Probe onResult={(r) => result.push(r)} />
        </ReadOnlyScope>
      </FieldDataSourceProvider>,
    );
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(result).toHaveLength(1));
    return { fake, result: result[0] };
  }

  it("answers read-only and never reaches the host", async () => {
    const { fake, result } = await press(true);
    expect(result).toEqual({ ok: false, error: m.editor_read_only() });
    expect(fake.commands).toEqual([]);
  });

  it("CONTROL - without read-only the same command reaches the host", async () => {
    const { fake, result } = await press(false);
    expect(result).toMatchObject({ ok: true });
    expect(fake.commands).toHaveLength(1);
  });
});

describe("readOnly turning on while a dialog that writes is open", () => {
  it("closes the publish dialog", async () => {
    stubViewport(1280);
    stubCamera(true);
    const fake = createFakeDataSource({ data: RATING_DATA, session: { collabEditing: true, tenantSlug: null } });
    const tree = (readOnly: boolean) => (
      <FieldDataSourceProvider dataSource={fake} slots={{ humanCheck: "not-required" }}>
        <FieldEditor data={RATING_DATA} readOnly={readOnly} />
      </FieldDataSourceProvider>
    );
    const { rerender } = render(tree(false));
    fireEvent.click(await screen.findByTestId("editor-publish-btn"));
    await screen.findByRole("dialog", { name: m.editor_publish_title() });
    rerender(tree(true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.editor_publish_title() })).toBeNull());
  });

  it("CONTROL - it stays open when the editor is not made read-only", async () => {
    stubViewport(1280);
    stubCamera(true);
    const fake = createFakeDataSource({ data: RATING_DATA, session: { collabEditing: true, tenantSlug: null } });
    const tree = (
      <FieldDataSourceProvider dataSource={fake} slots={{ humanCheck: "not-required" }}>
        <FieldEditor data={RATING_DATA} />
      </FieldDataSourceProvider>
    );
    const { rerender } = render(tree);
    fireEvent.click(await screen.findByTestId("editor-publish-btn"));
    await screen.findByRole("dialog", { name: m.editor_publish_title() });
    rerender(tree);
    expect(screen.getByRole("dialog", { name: m.editor_publish_title() })).toBeTruthy();
  });
});
