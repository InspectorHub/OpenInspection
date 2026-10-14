// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QboCopyButton } from "./QboCopyButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

function stubClipboard(writeText: (v: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("QboCopyButton", () => {
  it("writes the value to the clipboard and says it copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<QboCopyButton value="9341457665739480" label="Copy QuickBooks company ID" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy QuickBooks company ID" }));

    expect(writeText).toHaveBeenCalledWith("9341457665739480");
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("says so, without throwing, when there is no clipboard (a plain-http origin)", async () => {
    // `navigator.clipboard` is undefined outside a secure context.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<QboCopyButton value="x" label="Copy it" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy it" }));
    await waitFor(() => expect(screen.getByText("Copy failed")).toBeInTheDocument());
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("says so when the write is refused", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<QboCopyButton value="x" label="Copy it" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy it" }));
    await waitFor(() => expect(screen.getByText("Copy failed")).toBeInTheDocument());
  });
});
