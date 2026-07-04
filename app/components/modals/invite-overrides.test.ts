/**
 * Advanced-permissions disclosure on the invite modal (2026-06-13). happy-dom
 * has no render harness (see send-agreement-modal.spec header), so the toggle
 * set + the override-diff submit logic are unit-tested directly; the rendered
 * disclosure is Chrome-verified.
 */
import { describe, it, expect } from "vitest";
import { computeOverrideDiff, CAP_LABELS } from "~/components/modals/InviteSeatModal";
import { getCapabilities, TOGGLEABLE } from "../../../server/lib/auth/capabilities";

describe("CAP_LABELS — the four advanced-permission toggles", () => {
    it("labels every toggleable capability and only those", () => {
        expect(Object.keys(CAP_LABELS).sort()).toEqual([...TOGGLEABLE].sort());
        expect(CAP_LABELS.publish).toBe("Publish reports");
        expect(CAP_LABELS.scheduleOthers).toBe("Schedule for others");
        expect(CAP_LABELS.financial).toBe("Financial data");
        expect(CAP_LABELS.manageContacts).toBe("Manage contacts");
    });
});

describe("the disclosure initial state reflects the role template", () => {
    it("inspector defaults: publish on, the rest off", () => {
        const caps = getCapabilities("inspector", null);
        expect(caps).toEqual({
            publish: true, scheduleOthers: false, financial: false, manageContacts: false,
        });
    });
    it("manager defaults: all four on", () => {
        const caps = getCapabilities("manager", null);
        expect(caps).toEqual({
            publish: true, scheduleOthers: true, financial: true, manageContacts: true,
        });
    });
});

describe("computeOverrideDiff — only differing toggles are sent", () => {
    it("returns an empty diff when the edited caps equal the role template", () => {
        const role = "inspector" as const;
        const caps = getCapabilities(role, null);
        expect(computeOverrideDiff(role, caps)).toEqual({});
    });

    it("returns only the keys that differ from the template", () => {
        const role = "inspector" as const;
        const caps = { ...getCapabilities(role, null), scheduleOthers: true };
        expect(computeOverrideDiff(role, caps)).toEqual({ scheduleOthers: true });
    });

    it("captures a revoked default (manager template manageContacts on -> off)", () => {
        const role = "manager" as const;
        const caps = { ...getCapabilities(role, null), manageContacts: false };
        expect(computeOverrideDiff(role, caps)).toEqual({ manageContacts: false });
    });
});
