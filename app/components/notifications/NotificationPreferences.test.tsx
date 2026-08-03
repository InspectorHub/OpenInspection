// @vitest-environment happy-dom
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
  { id: "a", label: "Alpha", channels: { email: "on", sms: "on", in_app: "on" } },
  { id: "b", label: "Beta", channels: { email: "off", sms: "on", in_app: "on" } },
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
  it("offers every channel on every row", () => {
    // The screen reads neither the class's own channel list nor the tenant's
    // templates: a preference is a statement of intent worth storing before
    // the content exists.
    const c = setup();
    for (const ch of ["Email", "Text", "In-app"]) {
      expect(byLabel(c, `Turn ${ch}`)).toBeTruthy();
    }
    expect(boxes(c).filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Alpha"))).toHaveLength(3);
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

  it("DISABLES a locked channel rather than just showing it off", () => {
    // A revoked SMS consent makes every per-notification Text choice moot: no
    // text can arrive whatever the row says. Leaving the column live would let
    // someone tick "yes, text me" while consent says we may not — a screen
    // disagreeing with the send gate.
    const c = setup({ lockedChannels: { sms: "Text is switched off above." } });
    const sms = boxes(c).filter((b) => (b.getAttribute("aria-label") ?? "").endsWith("Text"));
    expect(sms.length).toBeGreaterThan(0);
    expect(sms.every((b) => b.disabled)).toBe(true);
    // ...and its bulk control goes with it: a select-all over cells that
    // cannot change is the empty-column lie again.
    expect(boxes(c).some((b) => (b.getAttribute("aria-label") ?? "").startsWith("Turn Text"))).toBe(false);
  });

  it("leaves the OTHER channels alone when one is locked", () => {
    const c = setup({ lockedChannels: { sms: "off" } });
    const email = boxes(c).filter((b) => (b.getAttribute("aria-label") ?? "").endsWith("Email"));
    expect(email.every((b) => !b.disabled)).toBe(true);
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

  it("says that a choice keeps applying if we start sending a new way later", () => {
    // Otherwise a reader switching off a channel nothing uses yet has no way
    // to know the answer was kept rather than ignored.
    const c = setup();
    expect(c.getByText(/keeps applying/i)).toBeTruthy();
  });
});
