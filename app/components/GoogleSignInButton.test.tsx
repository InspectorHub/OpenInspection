// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GoogleSignInButton } from "./GoogleSignInButton";

afterEach(cleanup);

describe("GoogleSignInButton pending", () => {
    it("keeps the button focusable, marks it aria-disabled and swallows the click", () => {
        const onClick = vi.fn();
        render(<GoogleSignInButton onClick={onClick} pending label="Connecting" />);
        const button = screen.getByRole("button", { name: "Connecting" });
        button.focus();
        expect(button.getAttribute("aria-disabled")).toBe("true");
        expect(button.hasAttribute("disabled")).toBe(false);
        expect(document.activeElement).toBe(button);
        fireEvent.click(button);
        expect(onClick).not.toHaveBeenCalled();
    });

    it("CONTROL - not pending, the click goes through", () => {
        const onClick = vi.fn();
        render(<GoogleSignInButton onClick={onClick} label="Go" />);
        const button = screen.getByRole("button", { name: "Go" });
        expect(button.getAttribute("aria-disabled")).toBeNull();
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("an href link does not navigate while pending", () => {
        render(<GoogleSignInButton href="/oauth/start" pending label="Link" />);
        const link = screen.getByText("Link").closest("a")!;
        expect(link.getAttribute("aria-disabled")).toBe("true");
        const notCancelled = fireEvent.click(link);
        expect(notCancelled).toBe(false);
    });
});
