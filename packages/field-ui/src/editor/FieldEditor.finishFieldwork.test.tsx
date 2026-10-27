// @vitest-environment happy-dom
/** Finish fieldwork moves the inspection's status, so every entry point asks first and the command goes out once. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { m } from "../i18n";
import { mountForRatings } from "./FieldEditor.rating.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const completes = (h: ReturnType<typeof mountForRatings>) => h.fake.commands.filter((c) => (c.cmd as { type: string }).type === "complete");
const dialog = () => screen.findByRole("dialog", { name: m.editor_finish_fieldwork_confirm_title() });

describe.each([["desktop", 1280], ["phone", 390]] as const)("%s: Finish fieldwork", (tree, width) => {
  async function open(h: ReturnType<typeof mountForRatings>) {
    if (tree === "desktop") {
      fireEvent.click(await screen.findByRole("button", { name: m.editor_finish_fieldwork() }));
    } else {
      fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
      const more = await screen.findByRole("dialog", { name: m.editor_mobile_more() });
      fireEvent.click(within(more).getByRole("button", { name: m.editor_finish_fieldwork() }));
    }
    return h;
  }

  it("asks first: the click opens the dialog and sends nothing", async () => {
    const h = mountForRatings(width);
    await open(h);
    await dialog();
    expect(completes(h)).toEqual([]);
  });

  it("confirming sends the command once, closes the dialog and says it is done", async () => {
    const h = mountForRatings(width);
    await open(h);
    const d = await dialog();
    fireEvent.click(within(d).getByRole("button", { name: m.editor_finish_fieldwork() }));
    await waitFor(() => expect(completes(h)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.editor_finish_fieldwork_confirm_title() })).toBeNull());
    expect(h.fake.notifications.map((n) => n.message)).toContain(m.editor_finish_fieldwork_done());
  });

  it("two presses of Confirm in one frame send it once", async () => {
    const h = mountForRatings(width);
    await open(h);
    const d = await dialog();
    const confirm = within(d).getByRole("button", { name: m.editor_finish_fieldwork() });
    act(() => { confirm.click(); confirm.click(); });
    await waitFor(() => expect(completes(h)).toHaveLength(1));
  });

  it("cancelling sends nothing and closes the dialog", async () => {
    const h = mountForRatings(width);
    await open(h);
    const d = await dialog();
    fireEvent.click(within(d).getByRole("button", { name: m.common_cancel() }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.editor_finish_fieldwork_confirm_title() })).toBeNull());
    expect(completes(h)).toEqual([]);
  });

  it("a refused finish keeps the error notice, says nothing of success and closes the dialog", async () => {
    const h = mountForRatings(width);
    h.fake.failExecute("complete", "Not allowed");
    await open(h);
    fireEvent.click(within(await dialog()).getByRole("button", { name: m.editor_finish_fieldwork() }));
    await waitFor(() => expect(h.fake.notifications.some((n) => n.variant === "error")).toBe(true));
    expect(h.fake.notifications.map((n) => n.message)).not.toContain(m.editor_finish_fieldwork_done());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.editor_finish_fieldwork_confirm_title() })).toBeNull());
  });
});
