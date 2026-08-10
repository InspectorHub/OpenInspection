// @vitest-environment happy-dom
/**
 * IA-102 — adding a person to an inspection is an AUTHORIZATION act wearing
 * the clothes of a data-entry one. Naming someone on the inspection is what
 * lets them open it, before publication and with no account; add the wrong
 * same-named agent and a stranger has the job, with no receipt anywhere.
 *
 * The notice must also not lie in the other direction. The link is a
 * per-inspection token that works with NO sign-up (IA-100), so any wording
 * implying an account or "their portal" would describe a barrier that does
 * not exist and would make operators expect a step that never comes.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { AddPersonModal } from "./AddPersonModal";
import { asSelect } from "../../../tests/helpers/dom";

const ROLES = [
  { id: "r-agent", key: "buyer_agent", label: "Buyer's Agent", kind: "agent", active: true },
  { id: "r-client", key: "client", label: "Client", kind: "client", active: true },
  { id: "r-other", key: "contractor", label: "Contractor", kind: "other", active: true },
];

function renderModal() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => {
        // The modal takes the hub's fetcher; a stub route with no action is
        // enough since these assertions never submit.
        return (
          <AddPersonModal
            open
            onClose={() => {}}
            roleProfiles={ROLES as never}
            isAdmin
            fetcher={{ state: "idle", data: undefined, submit: () => {} } as never}
          />
        );
      },
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const NOTICE = /lets them open this inspection from a link/i;

describe("AddPersonModal — access notice (IA-102)", () => {
  it("says nothing until a role is chosen", async () => {
    const { queryByText } = renderModal();
    expect(queryByText(NOTICE)).toBeNull();
  });

  it("warns when the chosen role hands over the report", async () => {
    const { findByLabelText, findByText } = renderModal();
    const select = asSelect(await findByLabelText(/role/i), "the role picker");

    fireEvent.change(select, { target: { value: "r-agent" } });
    expect(await findByText(NOTICE)).toBeTruthy();
  });

  it("warns for EVERY role kind, not just agents", async () => {
    // capabilitiesForKind gives receivesReport to client, agent and other
    // alike, so a notice that only fired for agents would quietly under-warn
    // on the tenant-custom roles most likely to be misconfigured.
    for (const roleId of ["r-client", "r-other"]) {
      const { findByLabelText, findByText, unmount } = renderModal();
      const select = asSelect(await findByLabelText(/role/i), "the role picker");
      fireEvent.change(select, { target: { value: roleId } });
      expect(await findByText(NOTICE)).toBeTruthy();
      unmount();
    }
  });

  it("never implies an account, a sign-up, or a portal", async () => {
    const { findByLabelText, container } = renderModal();
    const select = asSelect(await findByLabelText(/role/i), "the role picker");
    fireEvent.change(select, { target: { value: "r-agent" } });

    const text = container.textContent ?? "";
    expect(text).toMatch(/no sign-up/i);
    // The failure this guards: copy drifting toward "they will need an
    // account" / "in their portal", which is false for a token link.
    expect(text).not.toMatch(/create an account/i);
    expect(text).not.toMatch(/their portal/i);
    expect(text).not.toMatch(/must (register|sign up)/i);
  });

  it("points at where the access can be taken back", async () => {
    const { findByLabelText, container } = renderModal();
    const select = asSelect(await findByLabelText(/role/i), "the role picker");
    fireEvent.change(select, { target: { value: "r-agent" } });

    // A warning with no remedy is just anxiety — IA-100 built the revoke list.
    expect(container.textContent ?? "").toMatch(/revoke it any time/i);
  });
});
