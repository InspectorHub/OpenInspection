// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QboRegistrationUrls } from "./QboRegistrationUrls";
import { buildRegistration } from "~/lib/qbo-settings-loader";
import { qboRedirectUri } from "../../../server/lib/qbo-oauth-paths";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

const BASE = "https://dev.example.com";

describe("QboRegistrationUrls", () => {
  it("shows the three addresses, the redirect URI being the backend's own string", () => {
    const registration = buildRegistration(BASE);
    render(<QboRegistrationUrls registration={registration} />);

    // The expected value comes from the backend helper, not from a literal here.
    expect(screen.getByText(qboRedirectUri(BASE))).toBeInTheDocument();
    expect(screen.getByText(`${BASE}/integrations/quickbooks/disconnected`)).toBeInTheDocument();
    expect(screen.getByText(`${BASE}/webhooks/quickbooks`)).toBeInTheDocument();
    expect(screen.getByText(`${BASE}/api/integrations/qbo/callback`)).toBeInTheDocument();
  });

  it("gives every address its own copy button that copies that address", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<QboRegistrationUrls registration={buildRegistration(BASE)} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    for (const row of rows) fireEvent.click(within(row).getByRole("button", { name: /copy/i }));

    expect(writeText.mock.calls.map((c) => c[0])).toEqual([
      qboRedirectUri(BASE),
      `${BASE}/integrations/quickbooks/disconnected`,
      `${BASE}/webhooks/quickbooks`,
    ]);
  });

  it("warns that Intuit refuses plain http, and stays quiet for https", () => {
    const { unmount } = render(<QboRegistrationUrls registration={buildRegistration("http://localhost:8787")} />);
    expect(screen.getByText(/only accepts https/i)).toBeInTheDocument();
    unmount();
    render(<QboRegistrationUrls registration={buildRegistration(BASE)} />);
    expect(screen.queryByText(/only accepts https/i)).not.toBeInTheDocument();
  });

  it("explains the missing public address instead of showing empty rows", () => {
    render(<QboRegistrationUrls registration={null} />);
    expect(screen.getByText(/APP_BASE_URL/)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
