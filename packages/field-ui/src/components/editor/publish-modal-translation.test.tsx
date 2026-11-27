// @vitest-environment happy-dom
/**
 * "Also send a Spanish courtesy translation": the editor's publish dialog
 * offers the same per-publish opt-in the hub modal has (#506).
 *
 * The box exists only when the workspace may PRODUCE a translation, starts
 * unchecked (producing one spends money), and its value must LEAVE the dialog
 * on the publish submission as the locale — a checkbox that renders and is
 * then dropped on the way out is the defect, not a fix. The nudge is a fact
 * about the recipient, stated once next to the control; it never pre-ticks
 * the box.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { PublishModal, type PublishModalProps } from "./PublishModal";
import { FieldDataSourceProvider } from "../../context";
import { m } from "../../i18n";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";

const fake = createFakeDataSource({ data: createEmptyEditorData() });
function PM(props: PublishModalProps) {
  return (
    <FieldDataSourceProvider dataSource={fake}>
      <PublishModal {...props} />
    </FieldDataSourceProvider>
  );
}

afterEach(cleanup);

function props(over: Partial<PublishModalProps> = {}): PublishModalProps {
  return {
    open: true,
    inspectionId: "insp-1",
    progress: { rated: 40, total: 40, pct: 100 },
    status: "completed",
    publishError: null,
    isSubmitting: false,
    onClose: vi.fn(),
    onPublish: vi.fn(),
    autoSign: false,
    onAutoSignToggle: vi.fn(),
    isAmendment: false,
    noticeChoice: false,
    courtesyTranslationEnabled: true,
    courtesyTranslationLocale: "es-419",
    clientPrefersTranslation: false,
    ...over,
  };
}

const translateBox = () => screen.getByLabelText(m.courtesy_translation_publish_optin()) as HTMLInputElement;
const publishBtn = () => screen.getByText("Publish Now").closest("button") as HTMLButtonElement;

describe("PublishModal - courtesy translation opt-in (#506)", () => {
  it("is offered when the workspace may produce a translation, unchecked by default", () => {
    render(<PM {...props()} />);
    expect(translateBox().checked).toBe(false);
  });

  it("is NOT offered when the workspace may not produce one", () => {
    render(<PM {...props({ courtesyTranslationEnabled: false })} />);
    expect(screen.queryByLabelText(m.courtesy_translation_publish_optin())).toBeNull();
  });

  it("states the nudge when the client prefers the translation language, and only then", () => {
    const { rerender } = render(<PM {...props({ clientPrefersTranslation: true })} />);
    expect(screen.getByText(m.courtesy_translation_publish_nudge())).toBeTruthy();
    rerender(<PM {...props({ clientPrefersTranslation: false })} />);
    expect(screen.queryByText(m.courtesy_translation_publish_nudge())).toBeNull();
  });

  it("sends nothing about translating when left unchecked", () => {
    const onPublish = vi.fn();
    render(<PM {...props({ onPublish })} />);
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, {});
  });

  it("hands the locale to the publish submission when ticked", () => {
    const onPublish = vi.fn();
    render(<PM {...props({ onPublish })} />);
    fireEvent.click(translateBox());
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, { translateTo: "es-419" });
  });

  it("passes the locale it was given, not a hardcoded one", () => {
    const onPublish = vi.fn();
    render(<PM {...props({ onPublish, courtesyTranslationLocale: "fr" })} />);
    fireEvent.click(translateBox());
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, { translateTo: "fr" });
  });

  it("resets to unchecked when the dialog closes and reopens", () => {
    const view = render(<PM {...props()} />);
    fireEvent.click(translateBox());
    expect(translateBox().checked).toBe(true);
    view.rerender(<PM {...props({ open: false })} />);
    view.rerender(<PM {...props({ open: true })} />);
    expect(translateBox().checked).toBe(false);
  });
});
