// @vitest-environment happy-dom
/** Notes typed into one item and left without a blur reach that item's entry in the results document when another item opens. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { m } from "../i18n";
import { readResultMap } from "../collab/results-binding";
import { createEmptyEditorData } from "../testing/fake-data-source";
import { mountForRatings, RATING_DATA } from "./FieldEditor.rating.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const entry = (h: ReturnType<typeof mountForRatings>, id: string) => readResultMap(h.doc())[`_default:s1:${id}`] as { notes?: string } | undefined;

async function openItem(label: string) {
  fireEvent.click((await screen.findAllByText(label))[0]);
  await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
}

describe("a notes draft when another item is opened without leaving the field", () => {
  it("lands on the item it was typed into, and the new item is untouched", async () => {
    const h = mountForRatings(1280);
    await openItem("Flashing condition");
    const notes = document.getElementById("notes-textarea") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Granule loss at the eave." } });
    await openItem("Gutter condition");
    await waitFor(() => expect(entry(h, "i1")?.notes).toBe("Granule loss at the eave."));
    expect(entry(h, "i2")?.notes).toBeUndefined();
    expect((document.getElementById("notes-textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("CONTROL - nothing typed, nothing written to either item", async () => {
    const h = mountForRatings(1280);
    await openItem("Flashing condition");
    await openItem("Gutter condition");
    await new Promise((r) => setTimeout(r, 50));
    expect(entry(h, "i1")?.notes).toBeUndefined();
    expect(entry(h, "i2")?.notes).toBeUndefined();
  });
});

describe("the idle commit and an IME composition", () => {
  it("waits while a composition is open and commits a second after it ends", async () => {
    const h = mountForRatings(1280);
    await openItem("Flashing condition");
    const notes = document.getElementById("notes-textarea") as HTMLTextAreaElement;
    fireEvent.compositionStart(notes);
    fireEvent.change(notes, { target: { value: "\u306b\u307b" } });
    await new Promise((r) => setTimeout(r, 1300));
    expect(entry(h, "i1")?.notes).toBeUndefined();
    fireEvent.compositionEnd(notes);
    await waitFor(() => expect(entry(h, "i1")?.notes).toBe("\u306b\u307b"), { timeout: 2500 });
  });

  it("CONTROL - without a composition the text is committed after a second of quiet", async () => {
    const h = mountForRatings(1280);
    await openItem("Flashing condition");
    fireEvent.change(document.getElementById("notes-textarea") as HTMLTextAreaElement, { target: { value: "Granule loss." } });
    await waitFor(() => expect(entry(h, "i1")?.notes).toBe("Granule loss."), { timeout: 2500 });
  });
});

const TWO_SECTIONS = createEmptyEditorData({
  ...RATING_DATA,
  schema: {
    sections: [
      { id: "s1", title: "Roofing", items: [{ id: "i1", label: "Flashing condition", type: "rich" }, { id: "i2", label: "Gutter condition", type: "rich" }] },
      { id: "s2", title: "Attic", items: [{ id: "i3", label: "Insulation", type: "rich" }] },
    ],
  },
});
const entryIn = (h: ReturnType<typeof mountForRatings>, key: string) => readResultMap(h.doc())[key] as { notes?: string } | undefined;

describe("the explicit target of a draft that is committed after the screen moved on", () => {
  it("a section switch with an unblurred draft: the draft lands on its own item in its own section", async () => {
    const h = mountForRatings(1280, { data: TWO_SECTIONS });
    await openItem("Flashing condition");
    fireEvent.change(document.getElementById("notes-textarea") as HTMLTextAreaElement, { target: { value: "Granule loss." } });
    fireEvent.click((await screen.findAllByText("Attic"))[0]);
    await waitFor(() => expect(entryIn(h, "_default:s1:i1")?.notes).toBe("Granule loss."));
    expect(Object.keys(readResultMap(h.doc())).filter((k) => k.startsWith("_default:s2:"))).toEqual([]);
  });

  it("an item switch during an open IME composition (no compositionend): the draft lands on its item, and typing on the next one still commits", async () => {
    const h = mountForRatings(1280);
    await openItem("Flashing condition");
    const first = document.getElementById("notes-textarea") as HTMLTextAreaElement;
    fireEvent.compositionStart(first);
    fireEvent.change(first, { target: { value: "ab" } });
    await openItem("Gutter condition");
    await waitFor(() => expect(entry(h, "i1")?.notes).toBe("ab"));
    expect(entry(h, "i2")?.notes).toBeUndefined();
    fireEvent.change(document.getElementById("notes-textarea") as HTMLTextAreaElement, { target: { value: "cd" } });
    await waitFor(() => expect(entry(h, "i2")?.notes).toBe("cd"), { timeout: 2500 });
  });
});

const WITH_SNAPSHOT = createEmptyEditorData({
  ...RATING_DATA,
  templateSnapshot: { schemaVersion: 2, sections: [{ id: "s1", title: "Roofing", items: [{ id: "i1", label: "Flashing condition", type: "rich" }, { id: "i2", label: "Gutter condition", type: "rich" }, { id: "i3", label: "Chimney cap", type: "rich" }, { id: "i4", label: "Skylight seal", type: "rich" }] }] },
});

describe("a draft held for an item that is then removed", () => {
  it("is dropped: nothing is written for the removed item or into the open section", async () => {
    const h = mountForRatings(1280, { data: WITH_SNAPSHOT });
    await openItem("Flashing condition");
    fireEvent.change(document.getElementById("notes-textarea") as HTMLTextAreaElement, { target: { value: "Granule loss." } });
    fireEvent.click(await screen.findByRole("button", { name: m.editor_shared_edit_label({ label: "Flashing condition" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: m.common_delete() }));
    fireEvent.click(await screen.findByTestId("structure-delete-confirm"));
    await waitFor(() => expect(screen.queryAllByText("Flashing condition")).toHaveLength(0));
    await new Promise((r) => setTimeout(r, 1300));
    expect(Object.keys(readResultMap(h.doc()))).toEqual([]);
  });
});
