import { describe, it, expect } from "vitest";
import { canSendReportFor, hubAccess, inspectionStartedForView, mayActOnThisInspection, meAccessFromBody } from "~/lib/hub-access";

const open = { status: "scheduled", reportStatus: "in_progress", moneyCollected: false, mayAct: true, statusBeforeCancel: null };

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
            canEditOrder: true, canEditInspection: false, canChangeSchedule: true, canCancel: true, canRestore: false, canTurnGateOff: false,
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
        const a = hubAccess({ role: "staff", ...open, ...state });
        expect([a.canCancel, a.canChangeSchedule]).toEqual([false, false]);
        expect(inspectionStartedForView(state.status, state.reportStatus)).toBe(true);
    });
});

describe("staff who may not act on this inspection", () => {
    it("get none of the order controls", () => {
        expect(hubAccess({ role: "staff", ...open, mayAct: false })).toEqual({
            canEditOrder: false, canEditInspection: false, canChangeSchedule: false, canCancel: false, canRestore: false, canTurnGateOff: false,
        });
    });
    it("POSITIVE CONTROL - an inspector without the capability keeps everything (the server decides for them)", () => {
        expect(hubAccess({ role: "inspector", ...open, mayAct: false }).canCancel).toBe(true);
    });
});

describe("restore for staff follows the recorded status", () => {
    const staff = (statusBeforeCancel: string | null) => hubAccess({ role: "staff", ...open, status: "cancelled", statusBeforeCancel }).canRestore;
    it("is offered for a recorded, non-completed status only", () => {
        expect(staff("scheduled")).toBe(true);
        expect(staff("confirmed")).toBe(true);
        expect(staff("completed")).toBe(false);
        expect(staff(null)).toBe(false);
    });
});

describe("mayActOnThisInspection and canSendReportFor", () => {
    const base = { isAdmin: false, scheduleOthers: false, userId: "me", canPublishCap: true, role: "inspector" };
    it("needs admin, scheduleOthers or the assignment", () => {
        expect(mayActOnThisInspection(base, "other")).toBe(false);
        expect(mayActOnThisInspection({ ...base, isAdmin: true }, "other")).toBe(true);
        expect(mayActOnThisInspection({ ...base, scheduleOthers: true }, "other")).toBe(true);
        expect(mayActOnThisInspection(base, "me")).toBe(true);
        expect(mayActOnThisInspection({ ...base, userId: null }, null)).toBe(false);
    });
    it("sending asks for a place on the job, plus the publish condition for everyone but staff", () => {
        expect(canSendReportFor(base, "me")).toBe(true);
        expect(canSendReportFor({ ...base, canPublishCap: false }, "me")).toBe(false);
        expect(canSendReportFor({ ...base, role: "staff", canPublishCap: false, scheduleOthers: true }, "other")).toBe(true);
        expect(canSendReportFor({ ...base, role: "staff", canPublishCap: false }, "other")).toBe(false);
    });
});

describe("meAccessFromBody", () => {
    const body = (role: string, capabilities: Record<string, boolean>) => ({ data: { user: { id: "u9", role }, capabilities } });

    it("reads the user id and scheduleOthers from the server's resolved set", () => {
        expect(meAccessFromBody(body("staff", { publish: false, scheduleOthers: true }))).toMatchObject({ userId: "u9", scheduleOthers: true, canPublishCap: false });
    });

    it("CONTROL - a failed profile call resolves to the narrowest answer", () => {
        expect(meAccessFromBody(null)).toMatchObject({ scheduleOthers: false, canPublishCap: false, isAdmin: false, userId: null });
    });
});
