// @vitest-environment happy-dom
/**
 * The modal auto-closes itself when a save succeeds, and the value it reads to
 * decide that — `fetcher.data` — outlives the submission that produced it.
 *
 * That is the whole bug this file guards. A bare `data.ok === true` test is a
 * latch, not an event: once one save succeeds it reads true forever, so the
 * NEXT time the modal is opened the close-effect fires in the same commit and
 * the modal shuts before it paints. On the Roles page the symptom was that
 * every row click went dead after the first save, and only a full page reload
 * brought editing back.
 *
 * So the contract under test is deliberately narrow: only a save that happened
 * during THIS opening may close THIS opening.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";

// Mutable so each step of the lifecycle can be staged, then re-rendered — the
// point is what the component does ACROSS renders, not in any single one.
let fetcherState: "idle" | "submitting" = "idle";
let fetcherData: unknown = undefined;

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: vi.fn(() => ({
      get state() {
        return fetcherState;
      },
      get data() {
        return fetcherData;
      },
      submit: vi.fn(),
      load: vi.fn(),
      Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
        createElement("form", props, children),
    })),
  };
});

import { RoleProfileModal } from "~/components/contacts/RoleProfileModal";

function renderModal(open: boolean, onClose: () => void) {
  return render(
    <RoleProfileModal open={open} onClose={onClose} profile={null} templates={[]} />,
  );
}

beforeEach(() => {
  fetcherState = "idle";
  fetcherData = undefined;
});

describe("RoleProfileModal — capability editor", () => {
  const clientProfile = {
    id: "crp-client", key: "client", label: "Client", kind: "client" as const,
    emailTemplateId: null, smsTemplateId: null, isSystem: true, sortOrder: 1, active: true,
    capabilityOverrides: null,
  };

  it("disables canHaveAccount for a client-kind role and says why", () => {
    // Disabled with a visible reason, NOT hidden — a hidden control and an
    // inert one read identically, and only one of them is honest.
    const { container, getByText } = render(
      <RoleProfileModal open onClose={() => {}} profile={clientProfile} templates={[]} />,
    );
    const box = container.querySelector('input[name="cap_canHaveAccount"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.disabled).toBe(true);
    expect(getByText(/not yet available/i)).toBeTruthy();
  });

  it("renders every capability bit as a form control", () => {
    const { container } = render(
      <RoleProfileModal open onClose={() => {}} profile={clientProfile} templates={[]} />,
    );
    for (const name of ["cap_receivesReport", "cap_selfRetrieveReport", "cap_canHaveAccount", "cap_showsInAgentPortal"]) {
      expect(container.querySelector(`input[name="${name}"]`), name).toBeTruthy();
    }
    expect(container.querySelector('select[name="cap_canAccessRepairList"]')).toBeTruthy();
  });
});

describe("RoleProfileModal — auto-close on save", () => {
  it("closes once the save it started actually settles", () => {
    const onClose = vi.fn();
    const { rerender } = renderModal(true, onClose);
    expect(onClose).not.toHaveBeenCalled();

    // The user submits…
    fetcherState = "submitting";
    rerender(<RoleProfileModal open onClose={onClose} profile={null} templates={[]} />);
    expect(onClose).not.toHaveBeenCalled();

    // …and it comes back ok.
    fetcherState = "idle";
    fetcherData = { ok: true };
    rerender(<RoleProfileModal open onClose={onClose} profile={null} templates={[]} />);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when reopened while a PREVIOUS save's result is still around", () => {
    // The regression, stated directly. `fetcher.data` still holds {ok:true}
    // from a save that finished before this opening — it says nothing about
    // this one, so it must not close it.
    const onClose = vi.fn();
    fetcherData = { ok: true };

    const { rerender } = renderModal(false, onClose);
    rerender(<RoleProfileModal open onClose={onClose} profile={null} templates={[]} />);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on a failed save", () => {
    const onClose = vi.fn();
    renderModal(true, onClose);

    fetcherState = "submitting";
    fetcherData = undefined;
    const { rerender } = renderModal(true, onClose);

    fetcherState = "idle";
    fetcherData = { ok: false };
    rerender(<RoleProfileModal open onClose={onClose} profile={null} templates={[]} />);

    expect(onClose).not.toHaveBeenCalled();
  });
});
