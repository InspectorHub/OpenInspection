// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { AddMediaChooser } from "./AddMediaChooser";
import { m } from "../../i18n";

afterEach(cleanup);

const base = { onClose: vi.fn(), onTakePhoto: vi.fn(), onAddFromLibrary: vi.fn() };
const grid = () => screen.getByRole("button", { name: m.editor_addmedia_take_photo() }).parentElement as HTMLElement;

describe("AddMediaChooser video choice", () => {
  it("offers three choices in three columns when the host has the video flow", () => {
    render(<AddMediaChooser {...base} onPickVideo={vi.fn()} />);
    expect(screen.getByRole("button", { name: m.editor_addmedia_video() })).toBeTruthy();
    expect(grid().children).toHaveLength(3);
    expect(grid().className).toContain("grid-cols-3");
  });

  it("offers the two photo choices in two columns, with no video button, when it does not", () => {
    render(<AddMediaChooser {...base} />);
    expect(screen.queryByRole("button", { name: m.editor_addmedia_video() })).toBeNull();
    expect(screen.getByRole("button", { name: m.editor_addmedia_add_from_library() })).toBeTruthy();
    expect(grid().children).toHaveLength(2);
    expect(grid().className).toContain("grid-cols-2");
  });
});

describe("AddMediaChooser exit", () => {
  it("shows a Cancel of at least 44px that closes the chooser, not only an invisible backdrop", () => {
    const onClose = vi.fn();
    render(<AddMediaChooser {...base} onClose={onClose} />);
    const cancel = screen.getByRole("button", { name: m.common_cancel() });
    expect(cancel.className).toContain("min-h-[44px]");
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
