// @vitest-environment happy-dom
/**
 * The More trigger is always rendered and never hidden: the device-local
 * upload-quality toggle is a row with no inline copy, so the menu is never
 * empty and the trigger can never hide — without it the toggle would be
 * unreachable wherever the widest pivoted row has gone inline. Which of the
 * pivoted rows the menu holds still depends on the host (a theme slot or
 * not), the inspection (fieldwork finished or not), the session
 * (collaboration or not) and read-only; the matrix below exercises every
 * combination, and the trigger must be there in all of them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { ReadOnlyScope } from "../../read-only";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { m } from "../../i18n";
import { HeaderOverflowMenu } from "./HeaderOverflowMenu";

afterEach(cleanup);

const COMBOS = [false, true].flatMap((theme) => [false, true].flatMap((finish) => [false, true].flatMap((history) => [false, true].map((readOnly) => ({ theme, finish, history, readOnly })))));

describe("the More trigger", () => {
  it.each(COMBOS)("theme=$theme finish=$finish history=$history readOnly=$readOnly", (o) => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    render(
      <FieldDataSourceProvider dataSource={fake}>
        <ReadOnlyScope readOnly={o.readOnly}>
          <HeaderOverflowMenu
            onSign={vi.fn()}
            onFinishFieldwork={o.finish ? vi.fn() : null}
            finishingFieldwork={false}
            onOpenVersionHistory={o.history ? vi.fn() : null}
            themeControl={o.theme ? <div /> : null}
          />
        </ReadOnlyScope>
      </FieldDataSourceProvider>,
    );
    const trigger = screen.queryByRole("button", { name: m.editor_header_more() });
    // The upload-quality toggle keeps the menu non-empty in every combination,
    // so the trigger is always rendered — and carries no responsive hide class.
    expect(trigger).not.toBeNull();
    expect(trigger!.className).not.toMatch(/:hidden/);
  });
});
