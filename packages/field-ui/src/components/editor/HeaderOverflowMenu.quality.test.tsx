// @vitest-environment happy-dom
/**
 * The upload-quality toggle in the More menu: the device-local opt-out that
 * used to live in the settings sheet (#529 moved the sheet to the hub). It
 * writes to this device's localStorage, not to the inspection, and it is
 * shown even in read-only — a read-only inspector still uploads from this
 * device on their next inspection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { ReadOnlyScope } from "../../read-only";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { ORIGINAL_QUALITY_KEY } from "../../shared/original-quality";
import { m } from "../../i18n";
import { HeaderOverflowMenu } from "./HeaderOverflowMenu";

beforeEach(() => localStorage.removeItem(ORIGINAL_QUALITY_KEY));
afterEach(() => {
  cleanup();
  localStorage.removeItem(ORIGINAL_QUALITY_KEY);
});

function mount(readOnly = false) {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <ReadOnlyScope readOnly={readOnly}>
        <HeaderOverflowMenu
          onSign={vi.fn()}
          onFinishFieldwork={null}
          finishingFieldwork={false}
          onOpenVersionHistory={null}
          themeControl={null}
        />
      </ReadOnlyScope>
    </FieldDataSourceProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: m.editor_header_more() }));
  return screen.getByRole("checkbox", { name: new RegExp(m.editor_settings_original_quality()) });
}

describe("the upload-quality toggle", () => {
  it("writes the choice to localStorage and reads it back on mount", () => {
    const toggle = mount();
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(localStorage.getItem(ORIGINAL_QUALITY_KEY)).toBe("1");
    cleanup();
    expect(mount()).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(m.editor_settings_original_quality()) }));
    expect(localStorage.getItem(ORIGINAL_QUALITY_KEY)).toBeNull();
  });

  it("is shown in read-only: it is a device preference, not an inspection write", () => {
    expect(mount(true)).toBeTruthy();
  });
});
