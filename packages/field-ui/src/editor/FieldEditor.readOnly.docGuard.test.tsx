// @vitest-environment happy-dom
/**
 * The results document is the one writer a data source cannot refuse (a Yjs map `set` does not pass through the data
 * source or `doc.transact`), so a read-only editor never hands it to a write helper. This file takes the other guards
 * out of the way (the keyboard filter and the photo-operation guard are replaced by pass-throughs) and presses every
 * writing key: the withheld document alone must keep the editor from changing anything.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { m } from "../i18n";
import { loadResultsProjection } from "../shared/results-doc";
import type { ResultsProjection } from "../shared/results-doc.types";
import { mountForRatings } from "./FieldEditor.rating.fixtures";

vi.mock("../read-only-guards", () => ({
  readOnlyKeyboard: <T,>(h: T) => h,
  guardPhotoOps: <T,>(ops: T) => ops,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const SEEN = { "_default:s1:i1": { rating: "def", notes: "Granule loss.", photos: [{ key: "t/insp-1/a.jpg", mediaType: "photo" }] } } as ResultsProjection;

async function run(readOnly: boolean) {
  const h = mountForRatings(1280, { readOnly });
  await screen.findAllByText("Flashing condition");
  await waitFor(() => h.doc());
  let local = 0;
  h.doc().on("afterTransaction", (tr: Y.Transaction) => { if (tr.local) local += 1; });
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(h.doc()));
  loadResultsProjection(other, SEEN);
  Y.applyUpdate(h.doc(), Y.encodeStateAsUpdate(other, Y.encodeStateVector(h.doc())), "remote");
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await waitFor(() => expect(screen.queryByTestId("read-only-item") ?? screen.queryByRole("radiogroup", { name: m.editor_rating_aria() })).not.toBeNull());
  for (const key of ["1", "2", "3", "0", "n", "r", "R"]) fireEvent.keyDown(document.body, { key });
  await new Promise((r) => setTimeout(r, 100));
  return { h, local };
}

describe("the withheld results document", () => {
  it("read-only: rating, clearing, N/A and clone keys change nothing even with the keyboard filter removed", async () => {
    const { h, local } = await run(true);
    expect(local).toBe(0);
    expect(h.fake.commands).toEqual([]);
    expect(screen.getByTestId("read-only-rating").textContent).toBe("Defect");
  });

  it("CONTROL - not read-only, the same keys do write the document", async () => {
    const { local } = await run(false);
    expect(local).toBeGreaterThan(0);
  });
});
