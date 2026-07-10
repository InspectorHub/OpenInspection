import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { setValue, readResultMap } from "./results-binding";

describe("results-binding — result.value write path", () => {
  it("setValue writes value onto the finding, readable by composite + bare key", () => {
    const doc = new Y.Doc();
    setValue(doc, "s1", "i1", 1995);
    const map = readResultMap(doc);
    expect(map["_default:s1:i1"].value).toBe(1995);
    expect(map["i1"].value).toBe(1995); // dual-key mirror the editor relies on
  });

  it("setValue carries string and boolean scalars", () => {
    const doc = new Y.Doc();
    setValue(doc, "s2", "i2", "Tile");
    setValue(doc, "s2", "i3", true);
    const map = readResultMap(doc);
    expect(map["_default:s2:i2"].value).toBe("Tile");
    expect(map["_default:s2:i3"].value).toBe(true);
  });
});
