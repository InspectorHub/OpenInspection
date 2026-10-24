// @vitest-environment happy-dom
/**
 * The More drawer's rows for what the desktop header carried and the touch layouts did not: the PDF preview, the
 * Template actions and the Theme. Each is there when the host provides what it calls and absent otherwise; a
 * group with no rows has no heading.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MobileFinishDrawer, type MobileFinishDrawerProps } from "./MobileFinishDrawer";
import { m } from "../../i18n";

afterEach(cleanup);

const props = (over: Partial<MobileFinishDrawerProps> = {}): MobileFinishDrawerProps => ({
  open: true,
  onClose: () => {},
  onPublish: () => {},
  onSign: () => {},
  onOpenSettings: null,
  onFinishFieldwork: null,
  finishingFieldwork: false,
  onPreviewReport: null,
  ...over,
});
const sheet = () => screen.getByRole("dialog", { name: m.editor_mobile_more() });
const row = (name: string) => within(sheet()).queryByRole("button", { name });

describe("More drawer: Theme", () => {
  it("has a Theme row that closes the drawer and runs its handler; absent without a handler", () => {
    const onOpenTheme = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<MobileFinishDrawer {...props({ onOpenTheme, onClose })} />);
    fireEvent.click(row(m.nav_theme_label())!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenTheme).toHaveBeenCalledTimes(1);
    unmount();
    render(<MobileFinishDrawer {...props()} />);
    expect(row(m.nav_theme_label())).toBeNull();
  });
});

describe("More drawer: PDF", () => {
  it("shows the host's label after Web report, runs it, and is busy while the host says so", () => {
    const onPreviewPdf = vi.fn();
    render(<MobileFinishDrawer {...props({ onPreviewReport: () => {}, onPreviewPdf, pdfLabel: "PDF (ready in 5s)", pdfBusy: true })} />);
    const text = sheet().textContent ?? "";
    expect(text.indexOf(m.editor_header_preview_report())).toBeLessThan(text.indexOf("PDF (ready in 5s)"));
    const pdf = row("PDF (ready in 5s)")!;
    expect(pdf.getAttribute("aria-disabled")).toBe("true");
  });

  it("runs the handler once pressed, shows the host's error under it, and is absent without a handler", () => {
    const onPreviewPdf = vi.fn();
    const { unmount } = render(<MobileFinishDrawer {...props({ onPreviewPdf, pdfLabel: "PDF", pdfError: "Render failed" })} />);
    fireEvent.click(row("PDF")!);
    expect(onPreviewPdf).toHaveBeenCalledTimes(1);
    expect(sheet().textContent).toContain("Render failed");
    unmount();
    render(<MobileFinishDrawer {...props({ pdfLabel: "PDF" })} />);
    expect(row("PDF")).toBeNull();
  });
});

describe("More drawer: Template group", () => {
  it("lists exactly the actions provided, under a Template heading", () => {
    const saveNew = vi.fn();
    render(<MobileFinishDrawer {...props({ onChangeTemplate: () => {}, onSaveAsNewTemplate: saveNew, onUpdateSourceTemplate: null })} />);
    expect(within(sheet()).getByText(m.template_menu_template())).toBeTruthy();
    expect(row(m.template_menu_change())).not.toBeNull();
    expect(row(m.template_menu_update_source())).toBeNull();
    fireEvent.click(row(m.template_menu_save_new())!);
    expect(saveNew).toHaveBeenCalledTimes(1);
  });

  it("an action the host cannot do is left out: no settings sheet means no Change template; no source means no Update source", () => {
    render(<MobileFinishDrawer {...props({ onChangeTemplate: null, onSaveAsNewTemplate: () => {}, onUpdateSourceTemplate: () => {} })} />);
    expect(row(m.template_menu_change())).toBeNull();
    expect(row(m.template_menu_update_source())).not.toBeNull();
  });

  it("with none of the three there is no Template heading", () => {
    render(<MobileFinishDrawer {...props()} />);
    expect(within(sheet()).queryByText(m.template_menu_template())).toBeNull();
  });
});
