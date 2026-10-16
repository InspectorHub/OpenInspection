/**
 * The hub never offers a control the server would refuse.
 *
 * The page decides its controls with `hubAccess`; the server decides the same acts with
 * its own capability table and pure rules. This walks every role against every lifecycle
 * state, takes each role's capabilities from the SERVER's table (`getCapabilities`, not
 * hand-written booleans) and evaluates the server's rules (`classifyStaffPatch`,
 * `inspectionStarted`, `staff-rules`). Two claims:
 *
 *  1. everyone: a control the page offers is one the server accepts (never over-offered);
 *  2. office staff, whose restrictions are all pure rules: the page offers exactly what the
 *     server accepts, so a restriction cannot be added on one side only.
 *
 * The page cannot see roster helpers or results already entered, so for other roles it may
 * offer less than the server allows; that direction is not asserted.
 */
import { describe, it, expect } from "vitest";
import { hubAccess, mayActOnThisInspection, type HubAccess } from "~/lib/hub-access";
import { getCapabilities, type PermissionOverrides } from "../../server/lib/auth/capabilities";
import { isAdminRole, type Role } from "../../server/lib/auth/roles";
import { classifyStaffPatch, inspectionStarted } from "../../server/lib/inspection/order-fields";
import { mayActOn, staffMayCancelNow, staffMayRestoreFrom } from "../../server/lib/inspection/staff-rules";
import type { RestorableStatus } from "../../server/lib/inspection/cancel-restore";

interface Actor { name: string; role: Role; overrides: PermissionOverrides | null; assigned: boolean }
const ACTORS: Actor[] = [
    { name: "owner", role: "owner", overrides: null, assigned: false },
    { name: "manager", role: "manager", overrides: null, assigned: false },
    { name: "inspector on the job", role: "inspector", overrides: null, assigned: true },
    { name: "inspector not on the job", role: "inspector", overrides: null, assigned: false },
    { name: "staff with scheduleOthers", role: "staff", overrides: null, assigned: false },
    { name: "staff without scheduleOthers", role: "staff", overrides: { scheduleOthers: false }, assigned: false },
];

interface Job { name: string; status: string; reportStatus: string; moneyCollected: boolean; before: RestorableStatus | null }
const JOBS: Job[] = [
    { name: "scheduled, unpaid", status: "scheduled", reportStatus: "in_progress", moneyCollected: false, before: null },
    { name: "scheduled, money collected", status: "scheduled", reportStatus: "in_progress", moneyCollected: true, before: null },
    { name: "started (report submitted)", status: "scheduled", reportStatus: "submitted", moneyCollected: false, before: null },
    { name: "completed and published", status: "completed", reportStatus: "published", moneyCollected: true, before: null },
    { name: "cancelled, pre-cancel status recorded", status: "cancelled", reportStatus: "in_progress", moneyCollected: false, before: "scheduled" },
    { name: "cancelled, pre-cancel status completed", status: "cancelled", reportStatus: "in_progress", moneyCollected: false, before: "completed" },
    { name: "cancelled, pre-cancel status unknown", status: "cancelled", reportStatus: "in_progress", moneyCollected: false, before: null },
];

/** What the server accepts, from its own table and pure rules. */
function serverAllows(actor: Actor, job: Job): HubAccess {
    const caps = getCapabilities(actor.role, actor.overrides);
    const isStaff = actor.role === "staff";
    const mayAct = mayActOn({ isAdmin: isAdminRole(actor.role), onJob: actor.assigned, scheduleOthers: caps.scheduleOthers });
    if (!isStaff) {
        // Non-staff: the server refuses only a date or inspector change by someone who is neither on the job nor holds scheduleOthers.
        return { canEditOrder: true, canEditInspection: true, canChangeSchedule: mayAct, canCancel: true, canRestore: true, canTurnGateOff: true };
    }
    const started = inspectionStarted({ status: job.status, reportStatus: job.reportStatus, hasResultKeys: false });
    const state = { status: job.status, reportStatus: job.reportStatus, started, paymentRequired: true, agreementRequired: true };
    return {
        canEditOrder: mayAct && classifyStaffPatch({ referenceNumber: "R-1" }, state).ok,
        canEditInspection: false,
        canChangeSchedule: mayAct && classifyStaffPatch({ date: "2099-01-01", inspectorId: "someone" }, state).ok,
        canCancel: mayAct && staffMayCancelNow({ started, moneyCollected: job.moneyCollected }),
        canRestore: mayAct && staffMayRestoreFrom(job.before),
        canTurnGateOff: classifyStaffPatch({ paymentRequired: false }, state).ok,
    };
}

function pageOffers(actor: Actor, job: Job): HubAccess {
    const caps = getCapabilities(actor.role, actor.overrides);
    const me = { isAdmin: isAdminRole(actor.role), scheduleOthers: caps.scheduleOthers, userId: "me" };
    const mayAct = mayActOnThisInspection(me, actor.assigned ? "me" : "someone-else");
    return hubAccess({ role: actor.role, status: job.status, reportStatus: job.reportStatus, moneyCollected: job.moneyCollected, mayAct, statusBeforeCancel: job.before });
}

const KEYS = ["canEditOrder", "canEditInspection", "canChangeSchedule", "canCancel", "canRestore", "canTurnGateOff"] as const;
const CELLS = ACTORS.flatMap((actor) => JOBS.map((job) => [actor.name, job.name, actor, job] as const));

describe("hub access parity with the server", () => {
    it("walks the whole matrix", () => {
        // eslint-disable-next-line no-console
        console.log(`[parity] actors=${ACTORS.length} jobs=${JOBS.length} cells=${CELLS.length} controls=${KEYS.length}`);
        expect(CELLS).toHaveLength(ACTORS.length * JOBS.length);
        expect(CELLS.length).toBeGreaterThan(30);
    });

    it.each(CELLS)("%s / %s: nothing is offered that the server refuses", (_a, _j, actor, job) => {
        const offered = pageOffers(actor, job);
        const allowed = serverAllows(actor, job);
        const over = KEYS.filter((k) => offered[k] && !allowed[k]);
        expect(over).toEqual([]);
    });

    it.each(CELLS.filter(([, , actor]) => actor.role === "staff"))("%s / %s: staff are offered exactly what the server accepts", (_a, _j, actor, job) => {
        expect(pageOffers(actor, job)).toEqual(serverAllows(actor, job));
    });

    it("the matrix is not vacuous: it contains both offered and refused controls for staff", () => {
        const staffCells = CELLS.filter(([, , actor]) => actor.role === "staff");
        const flat = staffCells.flatMap(([, , actor, job]) => KEYS.map((k) => serverAllows(actor, job)[k]));
        expect(flat).toContain(true);
        expect(flat).toContain(false);
    });
});
