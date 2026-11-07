import { describe, expect, it } from "vitest";
import { itemNeighbours } from "./item-neighbours";

const sections = [
  { id: "roof", items: [{ id: "r1" }, { id: "r2" }] },
  { id: "empty", items: [] },
  { id: "attic", items: [{ id: "a1" }] },
  { id: "bare" },
];

describe("itemNeighbours", () => {
  it("steps within a section", () => {
    const n = itemNeighbours(sections, "roof", "r1");
    expect(n.prev).toBeNull();
    expect(n.next).toEqual({ sectionId: "roof", itemId: "r2" });
    expect(n.position).toEqual({ index: 1, total: 2 });
  });

  it("enters the next section from the last item, passing over a section with no items", () => {
    expect(itemNeighbours(sections, "roof", "r2").next).toEqual({ sectionId: "attic", itemId: "a1" });
  });

  it("enters the previous section at its last item from the first item", () => {
    expect(itemNeighbours(sections, "attic", "a1").prev).toEqual({ sectionId: "roof", itemId: "r2" });
  });

  it("has nothing past the ends", () => {
    expect(itemNeighbours(sections, "attic", "a1").next).toBeNull();
    expect(itemNeighbours(sections, "roof", "r1").prev).toBeNull();
  });

  it("walks only what the list shows, but never loses the open item", () => {
    const hidden = new Set(["r2"]);
    const visible = (_section: { id: string }, item: { id: string }) => !hidden.has(item.id);
    const n = itemNeighbours(sections, "roof", "r1", visible);
    expect(n.next).toEqual({ sectionId: "attic", itemId: "a1" });
    expect(n.position).toEqual({ index: 1, total: 1 });
    // The open item itself is hidden by the filter: it is still where the walk starts.
    const fromHidden = itemNeighbours(sections, "roof", "r2", visible);
    expect(fromHidden.prev).toEqual({ sectionId: "roof", itemId: "r1" });
    expect(fromHidden.next).toEqual({ sectionId: "attic", itemId: "a1" });
  });

  it("knows nothing about an item that is not there", () => {
    expect(itemNeighbours(sections, "roof", "zzz")).toEqual({ prev: null, next: null, position: null });
    expect(itemNeighbours(sections, "roof", null)).toEqual({ prev: null, next: null, position: null });
  });
});
