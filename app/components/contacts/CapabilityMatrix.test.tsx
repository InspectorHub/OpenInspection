/**
 * Task 11 (two-layer role model) — the `?` capability matrix on the Roles page.
 * Five booleans with no explanation is how email_template_id became IA-93:
 * configured in good faith, understood by nobody.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CapabilityMatrix } from "~/components/contacts/CapabilityMatrix";
import { CONTACT_BITS } from "../../../server/lib/people/capabilities";
import type { RoleProfile } from "./contacts-helpers";

const ROLES: RoleProfile[] = [
  {
    id: "crp-1", key: "buyer_agent", label: "Buyer's Agent", kind: "agent",
    emailTemplateId: null, smsTemplateId: null, isSystem: true, sortOrder: 1, active: true,
    capabilityOverrides: { receivesReport: true, selfRetrieveReport: true, canHaveAccount: true, showsInAgentPortal: true, canAccessRepairList: "readwrite" },
  },
  {
    id: "crp-2", key: "attorney", label: "Attorney", kind: "other",
    emailTemplateId: null, smsTemplateId: null, isSystem: true, sortOrder: 2, active: true,
    capabilityOverrides: null,
  },
];

describe("CapabilityMatrix", () => {
  it("is generated from the capability list, not hand-written", () => {
    // Every key of CONTACT_BITS appears as a column, so adding a sixth bit
    // cannot leave the matrix silently stale.
    const { container } = render(<CapabilityMatrix roles={ROLES} />);
    for (const key of Object.keys(CONTACT_BITS)) {
      expect(container.querySelector(`[data-capability="${key}"]`), key).toBeTruthy();
    }
  });

  it("lists every role it was given", () => {
    const { getByText } = render(<CapabilityMatrix roles={ROLES} />);
    expect(getByText("Buyer's Agent")).toBeTruthy();
    expect(getByText("Attorney")).toBeTruthy();
  });

  it("states the AND relationship for canAccessRepairList", () => {
    // An operator who ticks the box and sees no change must find out why here:
    // the company's agent repair-list setting also applies, stricter wins.
    const { container } = render(<CapabilityMatrix roles={ROLES} />);
    expect(container.textContent).toMatch(/stricter/i);
  });
});
