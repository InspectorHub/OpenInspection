import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ItemHeader } from "~/components/editor-shared/ItemHeader";

function html(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(ItemHeader, props as never));
}

describe("ItemHeader", () => {
  it("renders the label and optional number", () => {
    const out = html({ number: "01", label: "Roof covering" });
    expect(out).toContain("Roof covering");
    expect(out).toContain(">01<");
  });

  it("shows required and safety badges when flagged", () => {
    const out = html({ label: "Gas line", required: true, isSafety: true });
    expect(out.toLowerCase()).toContain("required");
    expect(out.toLowerCase()).toContain("safety");
    expect(out).toContain("bg-ih-bad-bg");
  });

  it("omits badges when the flags are absent", () => {
    const out = html({ label: "Roof" });
    expect(out.toLowerCase()).not.toContain("required");
  });

  it("uses the small size by default and the large size on demand", () => {
    expect(html({ label: "x" })).toContain("text-[13px]");
    expect(html({ label: "x", size: "lg" })).toContain("text-[19px]");
  });
});
