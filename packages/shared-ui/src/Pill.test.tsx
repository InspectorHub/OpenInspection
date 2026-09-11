// @vitest-environment happy-dom
/**
 * IA-88 ④ — two badges that mean different things rendered identically.
 *
 * `monitor` is a RATING. It is the "Monitor" level of the shipped rating
 * systems (`server/data/rating-system-seeds.ts`: Satisfactory / Monitor /
 * Defect / Not Inspected / Not Present, severity `marginal`, amber #f59e0b),
 * and the same amber is what `getRatingColor` hands the report. `warning` is a
 * WORKFLOW flag — "Not sent", "Not invoiced", "Expired", "Partially paid".
 *
 * Both mapped to `bg-ih-watch-bg text-ih-watch-fg`, so the hub's Invoice card
 * printed "Not invoiced" (`warning`) and "Awaiting payment" (`monitor`) as the
 * same orange chip. The call sites already passed two different tone NAMES,
 * which is why this reads as fixed until you follow the name to its tokens.
 *
 * The palette has four status hues (ok / watch / bad / info) and the rating
 * vocabulary owns three of them, so `warning` cannot take a second amber. It
 * keeps the attention hue and changes FORM instead: a hollow ringed chip
 * against the rating's filled one. `ring-1 ring-inset` and not `border`, so the
 * two chips stay the same height in a row that mixes them.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Pill, type PillTone } from "./Pill";

function chipClass(tone: PillTone): string {
  const { container } = render(<Pill tone={tone}>x</Pill>);
  return container.querySelector("span")!.className;
}

describe("Pill tones", () => {
  it("does not render `monitor` and `warning` as the same chip", () => {
    expect(chipClass("warning")).not.toBe(chipClass("monitor"));
  });

  it("keeps `monitor` on the canonical amber rating fill", () => {
    const cls = chipClass("monitor");
    expect(cls).toContain("bg-ih-watch-bg");
    expect(cls).toContain("text-ih-watch-fg");
  });

  it("draws `warning` as a hollow ringed chip, not a second amber fill", () => {
    const cls = chipClass("warning");
    expect(cls).not.toContain("bg-ih-watch-bg");
    expect(cls).toContain("ring-ih-watch");
    // The hue is still the attention hue — only the form changed.
    expect(cls).toContain("text-ih-watch-fg");
  });

  it("gives every tone in the rating vocabulary a distinct treatment", () => {
    // `gen` / `neutral` / `ni` are deliberate aliases of the muted chip and are
    // not in this set. These six are the ones a reader has to tell apart.
    const tones: PillTone[] = ["sat", "monitor", "defect", "ni", "np", "warning"];
    const seen = new Map<string, PillTone>();
    for (const tone of tones) {
      const cls = chipClass(tone);
      expect(seen.get(cls), `${tone} renders identically to ${seen.get(cls)}`).toBeUndefined();
      seen.set(cls, tone);
    }
    expect(seen.size).toBe(tones.length);
  });

  it("still renders the same tone the same way twice", () => {
    // Positive control: the assertions above would also pass if `chipClass`
    // were returning something that varies per render.
    expect(chipClass("monitor")).toBe(chipClass("monitor"));
  });
});
