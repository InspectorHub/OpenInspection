// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QboOAuthOutcomeBanner } from "./QboOAuthOutcome";

afterEach(cleanup);

const CODES = [
  "not_configured",
  "missing_qbo_env",
  "missing_base_url",
  "invalid_state",
  "oauth_failed",
  "access_denied",
  "realm_already_connected",
] as const;

/** Words a person reading this page must never meet. */
const FORBIDDEN = /workspace|tenant|platform|deployment|saas|hosted/i;

describe("QboOAuthOutcomeBanner - success", () => {
  it("announces success politely, and can be dismissed", () => {
    render(<QboOAuthOutcomeBanner outcome={{ connected: true, error: null }} />);
    expect(screen.getByRole("status")).toHaveTextContent("QuickBooks connected.");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("wins over an error code carried by the same address", () => {
    render(<QboOAuthOutcomeBanner outcome={{ connected: true, error: "oauth_failed" }} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("QboOAuthOutcomeBanner - failures", () => {
  it.each(CODES)("%s is an alert with its own wording and no forbidden vocabulary", (code) => {
    render(<QboOAuthOutcomeBanner outcome={{ connected: false, error: code }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent?.length).toBeGreaterThan(20);
    expect(alert).not.toHaveTextContent(FORBIDDEN);
    expect(alert).not.toHaveTextContent(/QuickBooks returned an error/);
  });

  it("gives every known code a different message", () => {
    const texts = new Set<string>();
    for (const code of CODES) {
      const { unmount } = render(<QboOAuthOutcomeBanner outcome={{ connected: false, error: code }} />);
      texts.add(screen.getByRole("alert").textContent ?? "");
      unmount();
    }
    expect(texts.size).toBe(CODES.length);
  });

  it("stays on screen: a failure offers no Dismiss", () => {
    render(<QboOAuthOutcomeBanner outcome={{ connected: false, error: "invalid_state" }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("still shows a code it does not know, as itself", () => {
    render(<QboOAuthOutcomeBanner outcome={{ connected: false, error: "brand_new_code" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("QuickBooks returned an error: brand_new_code");
  });

  it("says nothing at all when the page was not reached through the callback", () => {
    const { container } = render(<QboOAuthOutcomeBanner outcome={{ connected: false, error: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
