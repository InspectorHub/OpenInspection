import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AddItemTypeModal } from "~/components/editor/AddItemTypeModal";

function html(open: boolean): string {
  return renderToStaticMarkup(
    createElement(AddItemTypeModal, { open, onConfirm: () => {}, onCancel: () => {} }),
  );
}

describe("AddItemTypeModal", () => {
  it("renders nothing when closed", () => {
    expect(html(false)).toBe("");
  });

  it("renders a label input, a type picker, and confirm/cancel when open", () => {
    const out = html(true);
    expect(out).toContain('data-testid="add-item-label"');
    expect(out).toContain('data-testid="add-item-type"');
    expect(out).toContain('data-testid="add-item-confirm"');
    expect(out).toContain("Cancel");
    expect(out).toContain("Add item");
  });

  it("offers all 9 item types in the picker", () => {
    const out = html(true);
    for (const v of ["rich", "boolean", "text", "textarea", "number", "select", "multi_select", "date", "photo_only"]) {
      expect(out).toContain(`value="${v}"`);
    }
  });
});
