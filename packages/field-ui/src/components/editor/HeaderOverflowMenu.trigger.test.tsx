// @vitest-environment happy-dom
/**
 * The More trigger is a dead button wherever the menu would be empty. Which rows the menu holds depends on the host (a theme
 * slot or not), the inspection (fieldwork finished or not), the session (collaboration or not) and read-only; the
 * trigger must hide from the widest pivot among exactly those rows, and not be rendered when it holds none.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { ReadOnlyScope } from "../../read-only";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { m } from "../../i18n";
import { HeaderOverflowMenu } from "./HeaderOverflowMenu";

afterEach(cleanup);

/** Where each row stops being needed, written out here rather than read from the table under test. */
const HIDE_FROM = { sign: ["min-[1400px]:hidden", 1400], finish: ["2xl:hidden", 1536], history: ["xl:hidden", 1280], theme: ["min-[2100px]:hidden", 2100] } as const;

function expected(o: { theme: boolean; finish: boolean; history: boolean; readOnly: boolean }): string | null {
  const rows = [
    ...(o.readOnly ? [] : [HIDE_FROM.sign]),
    ...(o.finish ? [HIDE_FROM.finish] : []),
    ...(o.history ? [HIDE_FROM.history] : []),
    ...(o.theme ? [HIDE_FROM.theme] : []),
  ];
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b[1] - a[1])[0]![0];
}

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
    const want = expected(o);
    if (want === null) expect(trigger).toBeNull();
    else expect(trigger?.className.split(/\s+/)).toContain(want);
  });
});
