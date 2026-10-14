// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QboConnectCard } from "./QboConnectCard";

afterEach(cleanup);

describe("QboConnectCard - ready to connect", () => {
  it("links to the OAuth start with Intuit's own artwork", () => {
    render(<QboConnectCard ready onNeedCredentials={vi.fn()} />);
    const link = screen.getByRole("link", { name: /connect to quickbooks/i });
    expect(link).toHaveAttribute("href", "/api/integrations/qbo/connect");
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(link.querySelector("img")?.getAttribute("src")).toBe("/intuit/C2QB_green_btn_med_default.svg");
    expect([...link.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toContain(
      "/intuit/C2QB_green_btn_med_hover.svg",
    );
  });

  it("keeps Intuit's image size untouched", () => {
    render(<QboConnectCard ready onNeedCredentials={vi.fn()} />);
    const img = screen.getByRole("link", { name: /connect to quickbooks/i }).querySelector("img");
    expect(img).toHaveAttribute("width", "223");
    expect(img).toHaveAttribute("height", "36");
  });

  it("lists what connecting does, and who can do it", () => {
    render(<QboConnectCard ready onNeedCredentials={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Connect QuickBooks Online" })).toBeInTheDocument();
    expect(screen.getByText("Invoices are sent to QuickBooks as you create them")).toBeInTheDocument();
    expect(screen.getByText("Payment status comes back automatically")).toBeInTheDocument();
    expect(screen.getByText(/matched to customers by email/)).toBeInTheDocument();
    expect(screen.getByText("Voids and refunds follow through")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Before you connect" })).toBeInTheDocument();
    expect(screen.getByText("Owners and managers")).toBeInTheDocument();
  });

  it("does not show the 'finish setup first' note (control)", () => {
    render(<QboConnectCard ready onNeedCredentials={vi.fn()} />);
    expect(screen.queryByText(/Add your Intuit app/)).not.toBeInTheDocument();
  });
});

describe("QboConnectCard - Intuit app not set up yet", () => {
  it("disables the connect link, so it cannot start an OAuth round trip that is bound to fail", () => {
    render(<QboConnectCard ready={false} onNeedCredentials={vi.fn()} />);
    const link = screen.getByRole("link", { name: /connect to quickbooks/i });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link.getAttribute("href")).not.toContain("/api/integrations/qbo/connect");
    // Intuit's artwork may not be recoloured, so the image itself is untouched.
    expect(link.querySelector("img")?.getAttribute("src")).toBe("/intuit/C2QB_green_btn_med_default.svg");
  });

  it("says why, and points at the credentials section", () => {
    const onNeedCredentials = vi.fn();
    render(<QboConnectCard ready={false} onNeedCredentials={onNeedCredentials} />);
    expect(screen.getByText(/Add your Intuit app/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /connect to quickbooks/i }));
    expect(onNeedCredentials).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: "Go to Your Intuit app" }));
    expect(onNeedCredentials).toHaveBeenCalledTimes(2);
  });
});
