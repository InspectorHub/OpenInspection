/**
 * The bulk controls, and the one rule that is easy to get backwards.
 *
 * A row/column/corner checkbox is a promise about which cells it touches. The
 * failure worth pinning is the empty column: every cell an em dash, and a
 * checkbox above it that looks like "all off" and does nothing when clicked —
 * the exact lie the em dash exists to prevent, reintroduced one level up. It
 * shipped in the first draft and was caught in Chrome, not here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NotificationPreferences, type ChoiceRow } from "./NotificationPreferences";

const rows: ChoiceRow[] = [
  { id: "a", label: "Alpha", channels: { email: "on", sms: "unavailable", in_app: "unavailable" } },
  { id: "b", label: "Beta", channels: { email: "off", sms: "unavailable", in_app: "on" } },
];

function setup(over: Partial<Parameters<typeof NotificationPreferences>[0]> = {}) {
  const onBulk = vi.fn();
  const onChange = vi.fn();
  const utils = render(
    <NotificationPreferences
      alwaysSent={[]}
      youChoose={rows}
      onChange={onChange}
      onBulk={onBulk}
      {...over}
    />,
  );
  return { ...utils, onBulk, onChange };
}

const boxes = (c: ReturnType<typeof setup>) =>
  [...c.container.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
const byLabel = (c: ReturnType<typeof setup>, startsWith: string) =>
  boxes(c).find((b) => (b.getAttribute("aria-label") ?? "").startsWith(startsWith))!;

describe("bulk controls", () => {
  it("renders NO control for a channel every row is unavailable on", () => {
    // Text is an em dash on both rows. A checkbox there would be a control
    // over nothing.
    const c = setup();
    expect(boxes(c).some((b) => (b.getAttribute("aria-label") ?? "").includes("Text"))).toBe(false);
    // In-app has one real cell, so it keeps its control.
    expect(byLabel(c, "Turn In-app")).toBeTruthy();
  });

  it("shows a partly-on column as indeterminate, not as unchecked", () => {
    // Alpha's email is on and Beta's is off. Rendering that as plain unchecked
    // would invite "select all" on a column that is already half selected.
    const c = setup();
    const email = byLabel(c, "Turn Email");
    expect(email.checked).toBe(false);
    expect(email.indeterminate).toBe(true);
  });

  it("turns a partly-on column fully ON when clicked", () => {
    const c = setup();
    fireEvent.click(byLabel(c, "Turn Email"));
    expect(c.onBulk).toHaveBeenCalledWith(true, { channel: "email" });
  });

  it("turns a fully-on row OFF when clicked", () => {
    const c = setup();
    const row = byLabel(c, "Turn Alpha");
    expect(row.checked).toBe(true);
    fireEvent.click(row);
    expect(c.onBulk).toHaveBeenCalledWith(false, { classId: "a" });
  });

  it("scopes the corner control to the whole grid", () => {
    const c = setup();
    fireEvent.click(byLabel(c, "Turn every"));
    expect(c.onBulk).toHaveBeenCalledWith(true, {});
  });

  it("renders no bulk controls at all for a single-row screen", () => {
    // The row, the column and the grid all resolve to the same cell there.
    const c = setup({ youChoose: [rows[0]] });
    expect(boxes(c).filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Turn"))).toHaveLength(0);
  });

  it("shows the in-flight state inline, and never the result", () => {
    // The RESULT is a toast, because it has to reach a reader who scrolled
    // past this card. Only "saving" belongs next to the switch they touched.
    const c = setup({ status: "saving" });
    expect(c.getByText(/Saving/)).toBeTruthy();
    expect(c.queryByText(/^Saved$/)).toBeNull();
  });

  it("says what the dash means, rather than leaving it to be guessed", () => {
    // A reader who has to ask will guess "off", which is the wrong answer.
    const c = setup();
    expect(c.getByText(/dash means/i)).toBeTruthy();
  });
});
