/**
 * Advanced-permissions disclosure on the invite modal (2026-06-13). happy-dom
 * has no render harness (see send-agreement-modal.spec header), so the toggle
 * set + the override-diff submit logic are unit-tested directly; the rendered
 * disclosure is Chrome-verified.
 */
import { describe, it, expect } from "vitest";
import { computeOverrideDiff, CAP_LABELS, CAP_GROUPS } from "~/components/modals/InviteSeatDrawer";
import { getCapabilities, TOGGLEABLE } from "../../../server/lib/auth/capabilities";

describe("CAP_LABELS — the advanced-permission toggles", () => {
    it("labels every toggleable capability and only those", () => {
        expect(Object.keys(CAP_LABELS).sort()).toEqual([...TOGGLEABLE].sort());
        expect(CAP_LABELS.publish).toBe("Publish reports");
        expect(CAP_LABELS.scheduleOthers).toBe("Schedule for others");
        expect(CAP_LABELS.financial).toBe("Financial data");
        expect(CAP_LABELS.manageContacts).toBe("Manage contacts");
        expect(CAP_LABELS.viewCommunication).toBe("View sent messages & notices");
        expect(CAP_LABELS.templateCreate).toBe("Create templates");
        expect(CAP_LABELS.templateEdit).toBe("Edit templates");
        expect(CAP_LABELS.templateDelete).toBe("Delete templates");
        expect(CAP_LABELS.templateImport).toBe("Import templates");
    });
});

describe("CAP_GROUPS — the grouping both drawers render", () => {
    it("covers TOGGLEABLE exactly once", () => {
        // A tenth capability added to TOGGLEABLE and forgotten here would simply
        // not render -- unsettable by anyone, in silence. That is #77 again, one
        // layer up.
        const flat = CAP_GROUPS.flatMap(g => g.caps);
        expect([...flat].sort()).toEqual([...TOGGLEABLE].sort());
        expect(new Set(flat).size).toBe(flat.length);
    });

    it("gives every group a non-empty heading", () => {
        for (const g of CAP_GROUPS) {
            expect(g.label().length).toBeGreaterThan(0);
        }
    });
});

describe("the disclosure initial state reflects the role template", () => {
    it("inspector defaults: publish, comms and template authoring on; the rest off", () => {
        const caps = getCapabilities("inspector", null);
        expect(caps).toEqual({
            publish: true, scheduleOthers: false, financial: false, manageContacts: false, viewCommunication: true,
            // An inspector authors the templates they inspect against, so
            // create/edit/import stay on. Only DELETE is off: its repair cost
            // is rebuild-from-scratch rather than change-it-back (#307).
            templateCreate: true, templateEdit: true, templateDelete: false, templateImport: true,
        });
    });
    it("manager defaults: every capability on", () => {
        const caps = getCapabilities("manager", null);
        expect(caps).toEqual({
            publish: true, scheduleOthers: true, financial: true, manageContacts: true, viewCommunication: true,
            templateCreate: true, templateEdit: true, templateDelete: true, templateImport: true,
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
