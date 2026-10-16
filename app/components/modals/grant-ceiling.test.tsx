// @vitest-environment happy-dom
/**
 * The drawers offer a manager only what the manager could grant: the switches
 * they do not hold are disabled with a plain hint, and a role whose template
 * carries something they lack is not selectable. An owner sees the same form as
 * before. The server enforces all of it (tests/unit/team/grant-ceiling.spec.ts);
 * this only pins that the form does not offer what the server would refuse.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { getCapabilities } from "../../../server/lib/auth/capabilities";

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return { ...actual, useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn(), load: vi.fn() }) };
});

import { InviteSeatDrawer, drawerActorOf, type DrawerActor } from "./InviteSeatDrawer";
import { EditMemberDrawer } from "./EditMemberDrawer";

afterEach(cleanup);

const OWNER: DrawerActor = { role: "owner", capabilities: getCapabilities("owner", null) };
const MANAGER: DrawerActor = { role: "manager", capabilities: getCapabilities("manager", null) };
const MANAGER_NO_FINANCE: DrawerActor = { role: "manager", capabilities: getCapabilities("manager", { companyFinance: false }) };

function switchFor(container: HTMLElement, label: RegExp): HTMLInputElement {
    const el = Array.from(container.querySelectorAll("label")).find((l) => label.test(l.textContent ?? ""))?.querySelector("input");
    if (!(el instanceof HTMLInputElement)) throw new Error(`no switch for ${label}`);
    return el;
}

function openAdvanced(container: HTMLElement) {
    const btn = Array.from(container.ownerDocument.querySelectorAll("button")).find((b) => b.getAttribute("aria-expanded") === "false");
    if (btn) fireEvent.click(btn);
}

const FINANCE = /company finance/i;
const options = (): HTMLOptionElement[] => Array.from(document.querySelectorAll("select option"));

describe("InviteSeatDrawer for a manager", () => {
    it("disables a switch the manager does not hold, with the plain hint", () => {
        const { container } = render(<InviteSeatDrawer open onClose={() => {}} actor={MANAGER_NO_FINANCE} />);
        openAdvanced(document.body);
        const sw = switchFor(document.body, FINANCE);
        expect(sw.disabled).toBe(true);
        expect(sw.checked).toBe(false);
        expect(sw.title).toBe("Only an owner can grant this.");
        expect(document.body.textContent).toContain("Only an owner can grant this.");
        void container;
    });

    it("CONTROL - the same switch is enabled for a manager who holds it, and for an owner", () => {
        for (const actor of [MANAGER, OWNER]) {
            render(<InviteSeatDrawer open onClose={() => {}} actor={actor} />);
            openAdvanced(document.body);
            expect(switchFor(document.body, FINANCE).disabled).toBe(false);
            cleanup();
        }
    });

    it("CONTROL - a switch the manager does hold stays usable next to the disabled one", () => {
        render(<InviteSeatDrawer open onClose={() => {}} actor={MANAGER_NO_FINANCE} />);
        openAdvanced(document.body);
        expect(switchFor(document.body, /publish/i).disabled).toBe(false);
    });

    it("never offers owner, and disables the manager role when its template carries what the manager lacks", () => {
        render(<InviteSeatDrawer open onClose={() => {}} actor={MANAGER_NO_FINANCE} />);
        const byValue = Object.fromEntries(options().map((o) => [o.value, o]));
        expect(Object.keys(byValue).sort()).toEqual(["inspector", "manager", "staff"]);
        expect(byValue.manager!.disabled).toBe(true);
        expect(byValue.inspector!.disabled).toBe(false);
    });

    it("an owner is offered the same three roles as before, none disabled", () => {
        render(<InviteSeatDrawer open onClose={() => {}} actor={OWNER} />);
        expect(options().map((o) => o.value)).toEqual(["manager", "inspector", "staff"]);
        expect(options().some((o) => o.disabled)).toBe(false);
    });

    it("offers nothing to grant when the session did not load (fail closed)", () => {
        expect(drawerActorOf(null)).toBeNull();
        render(<InviteSeatDrawer open onClose={() => {}} actor={drawerActorOf(null)} />);
        expect(options()).toHaveLength(0);
        openAdvanced(document.body);
        expect(switchFor(document.body, FINANCE).disabled).toBe(true);
    });
});

describe("EditMemberDrawer for a manager", () => {
    const member = (permissionOverrides: Record<string, boolean> | null) =>
        ({ id: "m-1", name: "Dana", email: "dana@example.com", role: "inspector", permissionOverrides });

    it("disables a switch the manager lacks when the member does not hold it", () => {
        render(<EditMemberDrawer open onClose={() => {}} member={member(null)} actor={MANAGER_NO_FINANCE} />);
        const sw = switchFor(document.body, FINANCE);
        expect(sw.disabled).toBe(true);
        expect(sw.title).toBe("Only an owner can grant this.");
    });

    it("keeps it usable where the member already holds it, so it can be taken away", () => {
        render(<EditMemberDrawer open onClose={() => {}} member={member({ companyFinance: true })} actor={MANAGER_NO_FINANCE} />);
        const sw = switchFor(document.body, FINANCE);
        expect(sw.checked).toBe(true);
        expect(sw.disabled).toBe(false);
    });

    it("CONTROL - an owner and a fully-empowered manager can toggle it", () => {
        for (const actor of [OWNER, MANAGER]) {
            render(<EditMemberDrawer open onClose={() => {}} member={member(null)} actor={actor} />);
            expect(switchFor(document.body, FINANCE).disabled).toBe(false);
            cleanup();
        }
    });

    it("disables promotion to a role whose template carries what the manager lacks", () => {
        render(<EditMemberDrawer open onClose={() => {}} member={member(null)} actor={MANAGER_NO_FINANCE} />);
        const byValue = Object.fromEntries(options().map((o) => [o.value, o]));
        expect(byValue.manager!.disabled).toBe(true);
        expect(byValue.inspector!.disabled).toBe(false);
        expect(byValue.staff!.disabled).toBe(false);
    });
});
