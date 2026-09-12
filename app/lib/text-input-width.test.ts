// @vitest-environment node
/**
 * F38 — the template editor's name input clipped 31px off "Standard
 * Residential Inspection" (clientWidth 192, scrollWidth 223, `text-overflow:
 * clip`) with ~600px of empty toolbar beside it.
 *
 * The assertion that matters is about CONTENT, not classes: the field asks for
 * room for every character it holds. A fixed `w-48` fails the first test below
 * at any name longer than 16 characters, which is most of them.
 */
import { describe, it, expect } from "vitest";
import { textInputSize, TEXT_INPUT_MIN_CHARS, TEXT_INPUT_MAX_CHARS } from "./text-input-width";

describe("textInputSize", () => {
  it("asks for room for the whole value — the name from the defect included", () => {
    const name = "Standard Residential Inspection"; // 31 chars; the one that clipped
    expect(name.length).toBe(31);
    expect(textInputSize(name)).toBeGreaterThanOrEqual(name.length);
  });

  it("never shrinks below a clickable floor", () => {
    expect(textInputSize("")).toBe(TEXT_INPUT_MIN_CHARS);
    expect(textInputSize("Roof")).toBe(TEXT_INPUT_MIN_CHARS);
  });

  it("caps so one long name cannot push a toolbar around", () => {
    expect(textInputSize("x".repeat(500))).toBe(TEXT_INPUT_MAX_CHARS);
  });

  it("covers every length between the floor and the cap", () => {
    for (let n = TEXT_INPUT_MIN_CHARS; n <= TEXT_INPUT_MAX_CHARS; n++) {
      expect(textInputSize("x".repeat(n))).toBe(n);
    }
  });

  it("honours caller-supplied bounds", () => {
    expect(textInputSize("abcdef", 2, 4)).toBe(4);
    expect(textInputSize("a", 3, 10)).toBe(3);
  });
});
