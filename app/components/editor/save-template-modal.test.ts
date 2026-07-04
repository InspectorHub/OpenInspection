import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SaveTemplateModal } from "~/components/editor/SaveTemplateModal";

function html(mode: "back" | "new" | null): string {
  return renderToStaticMarkup(
    createElement(SaveTemplateModal, {
      mode,
      name: "",
      onChangeName: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
}

describe("SaveTemplateModal", () => {
  it("renders nothing when mode is null", () => {
    expect(html(null)).toBe("");
  });

  it("'new' mode shows a name input + create action", () => {
    const out = html("new");
    expect(out).toContain('data-testid="save-template-name"');
    expect(out).toContain('data-testid="save-template-confirm"');
    expect(out).toContain("Create template");
  });

  it("'back' mode warns + has no name input", () => {
    const out = html("back");
    expect(out).not.toContain('data-testid="save-template-name"');
    expect(out).toContain("Save to template");
    expect(out).toContain("frozen snapshot");
  });
});
