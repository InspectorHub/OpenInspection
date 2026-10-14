// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ContactQboCard } from "./ContactQboCard";

afterEach(cleanup);

const NOT_MATCHED = { linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 };
const MATCHED = { linked: true, qboCustomerId: "58", displayName: "Amy's Bird Sanctuary", openErrorCount: 0 };

function setup(over: Partial<React.ComponentProps<typeof ContactQboCard>> = {}) {
  const onOpenDialog = vi.fn();
  const onUnlink = vi.fn();
  render(
    <ContactQboCard
      connected
      link={NOT_MATCHED}
      onOpenDialog={onOpenDialog}
      onUnlink={onUnlink}
      unlinking={false}
      {...over}
    />,
  );
  return { onOpenDialog, onUnlink };
}

describe("ContactQboCard", () => {
  it("renders nothing when QuickBooks is not connected (control: the same props render when connected)", () => {
    const { container } = render(
      <ContactQboCard connected={false} link={MATCHED} onOpenDialog={vi.fn()} onUnlink={vi.fn()} unlinking={false} />,
    );
    expect(container).toBeEmptyDOMElement();
    cleanup();

    setup({ link: MATCHED });
    expect(screen.getByText("Matched to Amy's Bird Sanctuary")).toBeInTheDocument();
  });

  it("offers the match when the contact is not matched yet, and nothing to remove", () => {
    const { onOpenDialog } = setup();
    expect(screen.getByText("Not matched yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove match" })).not.toBeInTheDocument();
    act(() => { screen.getByRole("button", { name: "Match to a QuickBooks customer" }).click(); });
    expect(onOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("shows the recorded name when matched, with a way to change and to remove", () => {
    setup({ link: MATCHED });
    expect(screen.getByText("Matched to Amy's Bird Sanctuary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change match" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove match" })).toBeInTheDocument();
    expect(screen.queryByText("Not matched yet")).not.toBeInTheDocument();
  });

  it("says the name was not recorded and shows only the last four characters of the QuickBooks id", () => {
    setup({ link: { linked: true, qboCustomerId: "1234567890", displayName: null, openErrorCount: 0 } });
    expect(screen.getByText("Matched (name not recorded)")).toBeInTheDocument();
    expect(screen.getByText("QuickBooks customer ID ending in 7890")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("1234567890");
  });

  it("counts the items that need attention, singular and plural, and says nothing at zero", () => {
    setup({ link: { ...MATCHED, openErrorCount: 1 } });
    expect(screen.getByText("1 item needs attention")).toBeInTheDocument();
    cleanup();
    setup({ link: { ...NOT_MATCHED, openErrorCount: 3 } });
    expect(screen.getByText("3 items need attention")).toBeInTheDocument();
    cleanup();
    setup({ link: MATCHED });
    expect(screen.queryByText(/need attention|needs attention/)).not.toBeInTheDocument();
  });

  it("asks before removing, tells the truth about the consequence, and does not call onUnlink until confirmed", async () => {
    const { onUnlink } = setup({ link: MATCHED });
    await act(async () => { screen.getByRole("button", { name: "Remove match" }).click(); });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("does not change anything in QuickBooks");
    expect(dialog).toHaveTextContent("first looks for an existing QuickBooks customer with the same email");
    expect(dialog).toHaveTextContent("otherwise creates a new one");
    expect(onUnlink).not.toHaveBeenCalled();

    // Keeping the match closes it without a call.
    await act(async () => { screen.getByRole("button", { name: "Keep match" }).click(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onUnlink).not.toHaveBeenCalled();

    await act(async () => { screen.getByRole("button", { name: "Remove match" }).click(); });
    const confirm = Array.from(screen.getByRole("dialog").querySelectorAll("button")).find((b) => b.textContent === "Remove match")!;
    await act(async () => { confirm.click(); });
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });

  it("sends one unlink when the confirm button is clicked twice in the same frame", async () => {
    const { onUnlink } = setup({ link: MATCHED });
    await act(async () => { screen.getByRole("button", { name: "Remove match" }).click(); });
    const dialog = screen.getByRole("dialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Remove match")!;
    await act(async () => { confirm.click(); confirm.click(); });
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });

  it("keeps Remove on an archived contact that still holds a match, and offers no match button", () => {
    setup({ link: MATCHED, archived: true });
    expect(screen.getByRole("button", { name: "Remove match" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change match" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Match to a QuickBooks customer" })).not.toBeInTheDocument();
  });

  it("explains instead of offering a match on an archived contact with none (control: a live one offers it)", () => {
    setup({ archived: true });
    expect(screen.queryByRole("button", { name: "Match to a QuickBooks customer" })).not.toBeInTheDocument();
    expect(screen.getByText(/archived, so it cannot be matched/)).toBeInTheDocument();
    cleanup();
    setup();
    expect(screen.getByRole("button", { name: "Match to a QuickBooks customer" })).toBeInTheDocument();
    expect(screen.queryByText(/archived, so it cannot be matched/)).not.toBeInTheDocument();
  });

  it("reports a failed removal (control: no alert otherwise)", async () => {
    setup({ link: MATCHED, unlinkFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be removed");
    cleanup();
    setup({ link: MATCHED });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
