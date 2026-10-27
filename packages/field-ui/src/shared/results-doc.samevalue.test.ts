import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyItemPatch } from "./results-doc";

// Writing the value a field already holds is not a write: no update goes to the server and nothing is stored.
describe("applyItemPatch with the value already there", () => {
  const key = "_default:s1:i1" as Parameters<typeof applyItemPatch>[1];
  function updates(doc: Y.Doc) {
    let n = 0;
    doc.on("update", () => { n += 1; });
    return () => n;
  }

  it("emits no update the second time", () => {
    const doc = new Y.Doc();
    applyItemPatch(doc, key, "notes", "Granule loss");
    const count = updates(doc);
    applyItemPatch(doc, key, "notes", "Granule loss");
    expect(count()).toBe(0);
  });

  it("CONTROL - a different value is one update, and the first write of a field is one too", () => {
    const doc = new Y.Doc();
    const count = updates(doc);
    applyItemPatch(doc, key, "notes", "a");
    expect(count()).toBe(1);
    applyItemPatch(doc, key, "notes", "b");
    expect(count()).toBe(2);
    applyItemPatch(doc, key, "rating", "b");
    expect(count()).toBe(3);
  });
});
