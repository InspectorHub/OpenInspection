// @vitest-environment happy-dom
/**
 * Data entry parity: a rating typed in Speed mode, tapped in the item editor or pressed on a keyboard is the
 * same write. Every entry ends in the same `setRating(sectionId, itemId, ratingId)` call, leaves the same
 * entry in the results document and moves the same counters; Speed mode's Undo restores through that write
 * too, and a rating tap in Speed mode moves to the next unrated item, not past it. Run in all three trees.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { m } from "../i18n";
import { readResultMap } from "../collab/results-binding";
import { mountForRatings, type RatingMount } from "./FieldEditor.rating.fixtures";

const ratingCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("../collab/collab-findings-api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../collab/collab-findings-api")>();
  return {
    ...mod,
    buildCollabFindingsApi: (...args: Parameters<typeof mod.buildCollabFindingsApi>) => {
      const api = mod.buildCollabFindingsApi(...args);
      return {
        ...api,
        setRating: (...a: Parameters<typeof api.setRating>) => {
          ratingCalls.push(a);
          api.setRating(...a);
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  ratingCalls.length = 0;
});

const TREES = [
  ["desktop", 1280],
  ["tablet", 834],
  ["phone", 390],
] as const;
type Tree = (typeof TREES)[number][0];

const itemsTab = () => screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) });
const speedDialog = () => screen.getByRole("dialog", { name: m.editor_speedmode_aria_label() });
const speedTitle = () => within(speedDialog()).getByRole("heading", { level: 2 }).textContent;
const docEntry = (h: RatingMount, id: string) => readResultMap(h.doc())[`_default:s1:${id}`];

async function ready(tree: Tree) {
  if (tree === "phone") await itemsTab();
  else await screen.findAllByText("Flashing condition");
}
async function openItem(tree: Tree, label: string) {
  if (tree === "phone") fireEvent.click(await itemsTab());
  fireEvent.click((await screen.findAllByText(label))[0]);
  await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
}
async function openSpeed() {
  fireEvent.keyDown(document.body, { key: "z" });
  await screen.findByRole("dialog", { name: m.editor_speedmode_aria_label() });
}
const closeSpeed = () => fireEvent.click(within(speedDialog()).getByRole("button", { name: m.editor_speedmode_exit() }));
const filterText = () => screen.getByRole("radiogroup", { name: m.editor_route_item_filter() }).textContent ?? "";

describe.each(TREES)("%s: every rating entry is the same write", (tree, width) => {
  it("speed tap, speed key, item editor tap and a keyboard shortcut write identical entries and move the counters alike", async () => {
    const h = mountForRatings(width);
    await ready(tree);

    // 1. Speed mode, tap.
    await openSpeed();
    expect(speedTitle()).toBe("Flashing condition");
    fireEvent.click(within(speedDialog()).getByRole("button", { name: /Defect/ }));
    // 2. Speed mode, keyboard "3" (Defect): the tap moved to the NEXT unrated item, not past it.
    await waitFor(() => expect(speedTitle()).toBe("Gutter condition"));
    fireEvent.keyDown(document.body, { key: "3" });
    await waitFor(() => expect(speedTitle()).toBe("Chimney cap"));
    closeSpeed();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.editor_speedmode_aria_label() })).toBeNull());

    // 3. The item editor's rating row.
    await openItem(tree, "Chimney cap");
    fireEvent.click(screen.getByRole("radio", { name: "Defect" }));
    // 4. The keyboard shortcut on an open item.
    await openItem(tree, "Skylight seal");
    // A closing drawer puts focus back asynchronously, and until it has, focus can still sit on the drawer's own
    // button, where a single-key shortcut is (rightly) not live. What is under test is the shortcut, not that
    // timing: take focus off whatever holds it and retry until the press registers (a registered press ends the
    // retries, so it never writes twice).
    await waitFor(() => {
      if (ratingCalls.length < 4) {
        (document.activeElement as HTMLElement | null)?.blur();
        fireEvent.keyDown(document.body, { key: "3" });
      }
      expect(ratingCalls).toHaveLength(4);
    }, { timeout: 4000 });
    // One call shape: (sectionId, itemId, ratingId), the same for every entry.
    expect(ratingCalls).toEqual([
      ["s1", "i1", "def"],
      ["s1", "i2", "def"],
      ["s1", "i3", "def"],
      ["s1", "i4", "def"],
    ]);
    // One document shape.
    const entries = ["i1", "i2", "i3", "i4"].map((id) => docEntry(h, id));
    expect(entries[0]).toEqual({ rating: "def" });
    for (const e of entries) expect(e).toEqual(entries[0]);
    // Nothing is unrated any more, so Speed mode has nothing to offer; on the two-pane layouts the chips agree.
    if (tree !== "phone") {
      await waitFor(() => expect(filterText()).toMatch(/Unrated\s*0/));
      expect(filterText()).toMatch(/Issues\s*4/);
    }
    fireEvent.keyDown(document.body, { key: "z" });
    expect(screen.queryByRole("dialog", { name: m.editor_speedmode_aria_label() })).toBeNull();
  });

  it("Undo restores the previous value through the same write and puts the item back in the queue", async () => {
    const h = mountForRatings(width);
    await ready(tree);
    await openSpeed();
    fireEvent.click(within(speedDialog()).getByRole("button", { name: /Monitor/ }));
    await waitFor(() => expect(speedTitle()).toBe("Gutter condition"));
    // The toast outlives the item change the rating caused.
    fireEvent.click(await screen.findByRole("button", { name: m.common_undo() }));

    await waitFor(() => expect(ratingCalls).toEqual([["s1", "i1", "mon"], ["s1", "i1", null]]));
    expect(docEntry(h, "i1")?.rating ?? null).toBeNull();
    // The unrated item is current again, as the first of the three that are left plus itself.
    await waitFor(() => expect(speedTitle()).toBe("Flashing condition"));
    expect(within(speedDialog()).getByText("1 / 4")).toBeTruthy();
  });

  it("two rating taps in a row write each item once and each moves on to the next", async () => {
    mountForRatings(width);
    await ready(tree);
    await openSpeed();
    fireEvent.click(within(speedDialog()).getByRole("button", { name: /Satisfactory/ }));
    await waitFor(() => expect(speedTitle()).toBe("Gutter condition"));
    fireEvent.click(within(speedDialog()).getByRole("button", { name: /Defect/ }));
    await waitFor(() => expect(speedTitle()).toBe("Chimney cap"));
    expect(ratingCalls).toEqual([["s1", "i1", "ok"], ["s1", "i2", "def"]]);
    expect(within(speedDialog()).getByText("1 / 2")).toBeTruthy();
  });
});
