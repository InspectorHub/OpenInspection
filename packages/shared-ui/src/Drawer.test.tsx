import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Drawer } from "@core/shared-ui";

afterEach(cleanup);

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} title="Filters" onClose={() => {}}>
        x
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a right-side dialog panel with title and footer", () => {
    render(
      <Drawer open title="Filters" onClose={() => {}} footer={<button type="button">Apply</button>}>
        <p>body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Filters")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  });

  it("closes on Escape and on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Filters" onClose={onClose}>
        x
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("locks body scroll while open", () => {
    const { unmount } = render(
      <Drawer open title="Filters" onClose={() => {}}>
        x
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("uses the backdrop token", () => {
    render(
      <Drawer open title="Filters" onClose={() => {}}>
        x
      </Drawer>,
    );
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    expect(overlay.className).toContain("bg-ih-backdrop");
  });
});
