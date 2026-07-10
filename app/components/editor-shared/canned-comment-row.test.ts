import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CannedCommentRow } from "~/components/editor-shared/CannedCommentRow";

function html(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(CannedCommentRow, props as never));
}

describe("CannedCommentRow", () => {
  it("renders read-only title + category chip + body", () => {
    const out = html({
      title: "Roof shingles lifted",
      category: "safety",
      bodySlot: createElement("p", null, "Shingles are lifted."),
    });
    expect(out).toContain("Roof shingles lifted");
    expect(out).toContain(">safety<");
    expect(out).toContain("Shingles are lifted.");
  });

  it("applies the selected (primary-tint) shell when selected", () => {
    expect(html({ title: "x", selected: true })).toContain("bg-ih-primary-tint");
    expect(html({ title: "x", selected: false })).toContain("bg-ih-bg-app/50");
  });

  it("renders as a <label> by default and as a <div> when as='div'", () => {
    expect(html({ title: "x" }).startsWith("<label")).toBe(true);
    expect(html({ title: "x", as: "div" }).startsWith("<div")).toBe(true);
  });

  it("slots leading, trailing, and children (defect fields / photo chip)", () => {
    const out = html({
      title: "x",
      leading: createElement("input", { type: "checkbox", "data-testid": "lead" }),
      trailing: createElement("button", { "data-testid": "trail" }, "×"),
      children: createElement("div", { "data-testid": "kids" }, "fields"),
    });
    expect(out).toContain('data-testid="lead"');
    expect(out).toContain('data-testid="trail"');
    expect(out).toContain('data-testid="kids"');
  });

  it("renders an editable titleSlot and an extra badge in place of the plain title", () => {
    const out = html({
      titleSlot: createElement("input", { "data-testid": "title-input", defaultValue: "t" }),
      extraBadge: createElement("span", null, "custom"),
    });
    expect(out).toContain('data-testid="title-input"');
    expect(out).toContain(">custom<");
  });

  it("drops cursor-pointer/hover when interactive is false", () => {
    expect(html({ title: "x", as: "div", interactive: false })).not.toContain("cursor-pointer");
    expect(html({ title: "x" })).toContain("cursor-pointer");
  });

  it("forwards categoryColor to the chip's data-driven color (Plan-4 module K)", () => {
    const out = html({ title: "x", category: "safety", categoryColor: "#ff8800" });
    expect(out).toContain("color:#ff8800");
  });

  it("omits the inline color when categoryColor is unset (chip keeps its tokened fallback)", () => {
    const out = html({ title: "x", category: "safety" });
    expect(out).not.toContain("style=");
    expect(out).toContain("bg-ih-bad-bg");
  });
});
