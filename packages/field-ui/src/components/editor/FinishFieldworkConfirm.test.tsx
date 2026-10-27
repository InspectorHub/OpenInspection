// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { m } from "../../i18n";
import { useFinishFieldworkConfirm } from "./FinishFieldworkConfirm";

afterEach(cleanup);

function Probe({ finish }: { finish: () => Promise<void> }) {
  const { request, dialog } = useFinishFieldworkConfirm(finish, false);
  return <><button onClick={request}>ask</button>{dialog}</>;
}

describe("useFinishFieldworkConfirm", () => {
  it("closes the dialog even when the command rejects", async () => {
    const finish = vi.fn(() => Promise.reject(new Error("boom")));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    render(<Probe finish={finish} />);
    fireEvent.click(screen.getByText("ask"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: m.editor_finish_fieldwork() }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(finish).toHaveBeenCalledTimes(1);
    process.off("unhandledRejection", unhandled);
  });
});
