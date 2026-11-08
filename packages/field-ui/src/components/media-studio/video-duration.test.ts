import { describe, expect, it } from "vitest";
import { durationOrNull } from "./video-duration";

describe("durationOrNull", () => {
  it("keeps a finite, positive length", () => {
    expect(durationOrNull(12.4)).toBe(12.4);
  });

  it("drops what a browser reports when it does not know: Infinity (a MediaRecorder WebM), NaN, zero and negatives", () => {
    for (const bad of [Infinity, -Infinity, NaN, 0, -3]) expect(durationOrNull(bad)).toBeNull();
  });
});
