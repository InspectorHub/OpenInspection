import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DefectCategoryChip } from "~/components/editor-shared/DefectCategoryChip";

function html(category: string, className?: string): string {
  return renderToStaticMarkup(createElement(DefectCategoryChip, { category, className }));
}

describe("DefectCategoryChip", () => {
  it("maps safety to the bad tokens and shows the category text", () => {
    const out = html("safety");
    expect(out).toContain("bg-ih-bad-bg");
    expect(out).toContain("text-ih-bad-fg");
    expect(out).toContain(">safety<");
  });

  it("maps recommendation to the watch tokens", () => {
    const out = html("recommendation");
    expect(out).toContain("bg-ih-watch-bg");
    expect(out).toContain("text-ih-watch-fg");
    expect(out).toContain(">recommendation<");
  });

  it("maps maintenance / any other value to the muted tokens (fg-3, canonical)", () => {
    const out = html("maintenance");
    expect(out).toContain("bg-ih-bg-muted");
    expect(out).toContain("text-ih-fg-3");
    expect(out).not.toContain("text-ih-fg-2");
    expect(out).toContain(">maintenance<");
  });

  it("keeps the shared pill shape and appends an optional className (e.g. margin)", () => {
    const out = html("safety", "ml-1.5");
    expect(out).toContain("rounded-full");
    expect(out).toContain("uppercase");
    expect(out).toContain("ml-1.5");
  });
});
