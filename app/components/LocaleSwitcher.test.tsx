// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createRoutesStub } from "react-router";
import { LocaleSwitcher } from "./LocaleSwitcher";

/**
 * The switcher has to do BOTH writes or it is broken in a way that looks like
 * it works. Cookie only: the choice is lost on the next device, and — worse —
 * `auth-layout`'s stamp ranks the stored preference above the cookie and
 * corrects it straight back on the following navigation. Database only: nothing
 * changes until a round trip completes, so the control appears dead.
 *
 * Rendered through a real router stub rather than bare, so the assertion is on
 * what the PROFILE ACTION actually receives — a spy would pass against a
 * component that submits to nowhere.
 */
function renderSwitcher(serverLocale: string) {
  const submitted: { intent?: string; locale?: string } = {};
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ locale: serverLocale }),
      Component: () => <LocaleSwitcher />,
    },
    {
      path: "/settings/profile",
      action: async ({ request }: { request: Request }) => {
        const fd = await request.formData();
        submitted.intent = String(fd.get("intent"));
        submitted.locale = String(fd.get("locale"));
        return { success: true };
      },
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  return submitted;
}

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    // A cookie surviving between cases would let a test pass on the previous
    // test's write.
    document.cookie = "PARAGLIDE_LOCALE=; path=/; max-age=0";
  });

  it("writes the cookie and persists the choice", async () => {
    const submitted = renderSwitcher("en");
    fireEvent.click(await screen.findByRole("radio", { name: /español/i }));

    expect(document.cookie).toContain("PARAGLIDE_LOCALE=es-419");
    // Persisted as the tag the settings <select> stores, not the Paraglide tag:
    // saving 'es-419' here and 'en' in the other direction would make Profile
    // show "Use workspace default" for a preference just set.
    await waitFor(() => expect(submitted.intent).toBe("set-locale"));
    expect(submitted.locale).toBe("es-419");
  });

  it("switches back to English, storing the region-qualified tag", async () => {
    // The reverse direction, because a switcher that only ever answers Spanish
    // passes the test above.
    const submitted = renderSwitcher("es-419");
    fireEvent.click(await screen.findByRole("radio", { name: /english/i }));

    expect(document.cookie).toContain("PARAGLIDE_LOCALE=en");
    await waitFor(() => expect(submitted.locale).toBe("en-US"));
  });

  it("reflects the locale the SERVER rendered, not a local default", async () => {
    renderSwitcher("es-419");
    expect(await screen.findByRole("radio", { name: /español/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /english/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("does nothing when the current language is re-selected", async () => {
    const submitted = renderSwitcher("en");
    fireEvent.click(await screen.findByRole("radio", { name: /english/i }));

    expect(document.cookie).not.toContain("PARAGLIDE_LOCALE=");
    expect(submitted.intent).toBeUndefined();
  });

  it("understands a stored tag the cookie contract cannot serve", async () => {
    // The root loader reports whatever the paraglide scope resolved, but a
    // regional tag reaching this control must still select a real segment
    // rather than leaving every one of them unchecked.
    renderSwitcher("es-MX");
    expect(await screen.findByRole("radio", { name: /español/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
