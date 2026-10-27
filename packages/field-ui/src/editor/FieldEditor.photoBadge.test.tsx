// @vitest-environment happy-dom
/**
 * The Photos tab badge counts the photos of the inspection. The live results hold the same item under two keys (the
 * composite `_default:section:item` and the bare item id), so a sum of list lengths counts one photo twice.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { createEmptyEditorData } from "../testing/fake-data-source";
import { DATA, mount } from "./FieldEditor.capabilities.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withResults = (results: Record<string, unknown>) => createEmptyEditorData({ ...DATA, results: results as typeof DATA.results });

async function badge(results: Record<string, unknown>) {
  mount(null, false, withResults(results), 1440);
  await screen.findByTestId("inspection-details-entry");
  const photosTab = document.querySelector('div.w-11 button[title="Photos"]') as HTMLElement;
  return photosTab.querySelector("span.rounded-full")?.textContent ?? null;
}

describe("Photos tab badge", () => {
  it("counts one photo once when the same item is held under two keys", async () => {
    const photo = { key: "t/i/a.jpg", mediaType: "photo" };
    expect(await badge({ "_default:s1:i1": { photos: [photo] }, i1: { photos: [photo] } })).toBe("1");
  });

  it("CONTROL - two different photos count as two", async () => {
    expect(await badge({ "_default:s1:i1": { photos: [{ key: "t/i/a.jpg" }] }, "_default:s1:i2": { photos: [{ key: "t/i/b.jpg" }] } })).toBe("2");
  });

  it("does not count an entry with no key (a video, a photo still waiting to upload)", async () => {
    expect(await badge({ "_default:s1:i1": { photos: [{ key: "t/i/a.jpg" }, { key: "", mediaType: "video", streamUid: "u" } ] } })).toBe("1");
  });
});
