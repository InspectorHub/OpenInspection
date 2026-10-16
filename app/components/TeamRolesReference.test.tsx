// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TeamRolesReference } from "./TeamRolesReference";
import { ROLE_TONES } from "~/routes/team.shapes";
import { ROLES } from "../../server/lib/auth/roles";

describe("the roles reference beneath the roster", () => {
    it("describes every role, once, including the office role", () => {
        const view = render(<TeamRolesReference />);
        for (const name of ["Owner", "Manager", "Inspector", "Staff", "Agent"]) {
            expect(view.getAllByText(name)).toHaveLength(1);
        }
        expect(view.container.querySelectorAll("div.p-3").length).toBe(ROLES.length);
    });

    it("gives every role a pill tone, so the roster does not fall back to the generic one by accident", () => {
        for (const role of ROLES) expect(ROLE_TONES[role]).toBeTruthy();
    });
});
