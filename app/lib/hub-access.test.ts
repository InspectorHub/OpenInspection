import { describe, it, expect } from "vitest";
import { hubAccess, meAccessFromBody, inspectionStartedForView } from "~/lib/hub-access";

const open = { status: "scheduled", reportStatus: "in_progress", moneyCollected: false };

describe("hubAccess", () => {
    it("gives every role but staff everything", () => {
        for (const role of ["owner", "manager", "inspector"]) {
            expect(hubAccess({ role, ...open, moneyCollected: true, status: "completed", reportStatus: "published" })).toEqual({
                canEditOrder: true, canEditInspection: true, canChangeSchedule: true, canCancel: true, canRestore: true, canTurnGateOff: true,
            });
        }
    });

    it("staff keep the booking and lose the inspection", () => {
        expect(hubAccess({ role: "staff", ...open })).toEqual({
            canEditOrder: true, canEditInspection: false, canChangeSchedule: true, canCancel: true, canRestore: true, canTurnGateOff: false,
        });
    });

    it("staff cannot cancel once money is collected, though they still reschedule", () => {
        const a = hubAccess({ role: "staff", ...open, moneyCollected: true });
        expect([a.canCancel, a.canChangeSchedule]).toEqual([false, true]);
    });

    it.each([
        ["the visit is completed", { status: "completed", reportStatus: "in_progress" }],
        ["the report was submitted", { status: "scheduled", reportStatus: "submitted" }],
        ["the report was published", { status: "scheduled", reportStatus: "published" }],
    ])("staff cannot cancel or reschedule once %s", (_n, state) => {
        const a = hubAccess({ role: "staff", moneyCollected: false, ...state });
        expect([a.canCancel, a.canChangeSchedule]).toEqual([false, false]);
        expect(inspectionStartedForView(state.status, state.reportStatus)).toBe(true);
    });

    it("staff cannot restore a job whose report has moved on, and can restore one whose report has not", () => {
        expect(hubAccess({ role: "staff", ...open, reportStatus: "published" }).canRestore).toBe(false);
        expect(hubAccess({ role: "staff", ...open, status: "cancelled" }).canRestore).toBe(true);
    });
});

describe("meAccessFromBody", () => {
    const body = (role: string, capabilities: Record<string, boolean>) => ({ data: { user: { role }, capabilities } });

    it("lets sending a report stand apart from publishing", () => {
        const staff = meAccessFromBody(body("staff", { publish: false, scheduleOthers: true }));
        expect([staff.canPublishCap, staff.canSendReport]).toEqual([false, true]);
        const manager = meAccessFromBody(body("manager", { publish: false }));
        expect([manager.canPublishCap, manager.canSendReport]).toEqual([false, true]);
    });

    it("CONTROL - office staff without scheduleOthers cannot send, and neither can a failed profile call", () => {
        expect(meAccessFromBody(body("staff", { scheduleOthers: false })).canSendReport).toBe(false);
        expect(meAccessFromBody(null)).toMatchObject({ canSendReport: false, canPublishCap: false, isAdmin: false });
    });
});
