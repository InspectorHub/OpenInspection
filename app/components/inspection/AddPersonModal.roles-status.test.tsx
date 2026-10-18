// @vitest-environment happy-dom
/**
 * The role list for the add-person dialog loads when the dialog is first opened.
 * While it is on its way, or if it failed, the dialog must not say "no roles are
 * configured" (that is a statement about the company, and a late or failed read
 * is not evidence of it), and nothing can be submitted.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { AddPersonModal } from "./AddPersonModal";
import { asSelect } from "../../../tests/helpers/dom";

const ROLES = [{ id: "r-agent", key: "buyer_agent", label: "Buyer's Agent", kind: "agent", active: true }];
const NO_ROLES = /no role profiles/i;

function renderModal(extra: { rolesStatus?: "idle" | "loading" | "ready" | "error"; roles?: unknown[]; onRetry?: () => void }) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <AddPersonModal
          open
          onClose={() => {}}
          roleProfiles={(extra.roles ?? []) as never}
          isAdmin
          fetcher={{ state: "idle", data: undefined, submit: () => {} } as never}
          submit={() => true}
          submitting={false}
          {...(extra.rolesStatus ? { rolesStatus: extra.rolesStatus } : {})}
          {...(extra.onRetry ? { onRetryRoles: extra.onRetry } : {})}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("AddPersonModal role list status", () => {
  it.each(["idle", "loading"] as const)("(%s) disables the role picker, shows loading and does not claim there are no roles", async (status) => {
    const { findByLabelText, container } = renderModal({ rolesStatus: status });
    const select = asSelect(await findByLabelText(/role/i), "the role picker");
    expect(select.disabled).toBe(true);
    expect(container.textContent).toMatch(/loading/i);
    expect(container.textContent ?? "").not.toMatch(NO_ROLES);
    expect(document.body.textContent ?? "").not.toMatch(NO_ROLES);
  });

  it("(error) says the list could not be loaded, offers a retry, and still does not claim there are no roles", async () => {
    const onRetry = vi.fn();
    renderModal({ rolesStatus: "error", onRetry });
    expect(await screen.findByText(/could not load this list/i)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(NO_ROLES);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("asks for the list when the dialog opens", async () => {
    const onRequest = vi.fn();
    const Stub = createRoutesStub([{ path: "/", Component: () => (
      <AddPersonModal open onClose={() => {}} roleProfiles={[]} rolesStatus="idle" onRequestRoles={onRequest} isAdmin fetcher={{ state: "idle", data: undefined, submit: () => {} } as never} submit={() => true} submitting={false} />
    ) }]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByLabelText(/role/i);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("(ready, empty) is the one state allowed to say there are no roles", async () => {
    renderModal({ rolesStatus: "ready", roles: [] });
    await screen.findByLabelText(/role/i);
    expect(document.body.textContent ?? "").toMatch(NO_ROLES);
  });

  it("POSITIVE CONTROL: ready with roles enables the picker, and without a status prop it behaves as before", async () => {
    for (const rolesStatus of ["ready", undefined] as const) {
      const { findByLabelText, unmount } = renderModal({ roles: ROLES, ...(rolesStatus ? { rolesStatus } : {}) });
      const select = asSelect(await findByLabelText(/role/i), "the role picker");
      expect(select.disabled).toBe(false);
      fireEvent.change(select, { target: { value: "r-agent" } });
      expect(select.value).toBe("r-agent");
      unmount();
    }
  });

  it("the loading and error text is a polite live region that the disabled picker points at", async () => {
    for (const status of ["loading", "error"] as const) {
      const { findByLabelText, unmount } = renderModal({ rolesStatus: status });
      const select = asSelect(await findByLabelText(/role/i), "the role picker");
      const region = document.getElementById(select.getAttribute("aria-describedby") ?? "none");
      expect(region?.getAttribute("role")).toBe("status");
      expect(region?.getAttribute("aria-live")).toBe("polite");
      expect(region?.textContent ?? "").toMatch(status === "loading" ? /loading/i : /could not load this list/i);
      unmount();
    }
  });
});
