/**
 * What the inspection hub offers the viewer, in one place.
 *
 * The hub used to ask one question, "is this an office user?", and answer it for
 * every control. The server makes finer calls, so the page asks the same ones:
 *
 * - the BOOKING (people, price, requirements, references, cancelling a job nothing
 *   has been collected on) is open to office staff who may act on the job;
 * - the INSPECTION (marking the visit complete, the report editor, publishing) is not;
 * - who, where and when freeze for staff once the inspection has started;
 * - staff turn a payment or agreement requirement on, never off.
 *
 * Presentation only: every rule is enforced by the API, and a control that is
 * hidden here is one the server would refuse. The "started" test is the part of
 * the server's rule the page can see (a completed visit, or a report past
 * `in_progress`); the server also counts results already entered, and answers 403
 * for the rest.
 */
import { isAdminRole, isStaffRole } from "~/lib/access";
import { publishCapFromMe, viewCommunicationCapFromMe } from "~/lib/inspector-portal-helpers";
import { INSPECTION_STATUS } from "../../server/lib/status/inspection-status";
import { REPORT_STATUS } from "../../server/lib/status/report-status";

export interface MeAccess {
  canPublishCap: boolean;
  canViewCommunication: boolean;
  /** Whether this user holds `scheduleOthers`: the capability that lets them act on a job they are not on. */
  scheduleOthers: boolean;
  userId: string | null;
  role: string;
  isAdmin: boolean;
}

/** The viewer's access from the `/auth/me` body. A missing or failed body resolves to the narrowest answer. */
export function meAccessFromBody(
  meBody: { data?: { user?: { id?: string; role?: string }; capabilities?: { publish?: boolean; viewCommunication?: boolean; scheduleOthers?: boolean } } } | null,
): MeAccess {
  if (!meBody) return { canPublishCap: false, canViewCommunication: false, scheduleOthers: false, userId: null, role: "inspector", isAdmin: false };
  const role = meBody.data?.user?.role ?? "inspector";
  return {
    canPublishCap: publishCapFromMe(meBody),
    canViewCommunication: viewCommunicationCapFromMe(meBody),
    scheduleOthers: meBody.data?.capabilities?.scheduleOthers === true,
    userId: meBody.data?.user?.id ?? null,
    role,
    isAdmin: isAdminRole(role),
  };
}

/**
 * Whether the viewer may act on THIS inspection: an owner or manager, someone with
 * `scheduleOthers`, or the inspector it is assigned to. The server's `mayActOnInspection`
 * also counts helpers on the roster, which the page cannot see; such a viewer is
 * under-offered here, never over-offered.
 */
export function mayActOnThisInspection(me: Pick<MeAccess, "isAdmin" | "scheduleOthers" | "userId">, inspectorId: string | null): boolean {
  return me.isAdmin || me.scheduleOthers || (me.userId !== null && me.userId === inspectorId);
}

/**
 * Sending an already published report is not publishing it, so it is not the publish
 * capability the server checks: it needs a place on the job or `scheduleOthers`. For
 * everyone but staff the page keeps the earlier condition as well (an inspector whose
 * publish was withdrawn is not offered a send); staff never hold publish.
 */
export function canSendReportFor(me: Pick<MeAccess, "canPublishCap" | "isAdmin" | "scheduleOthers" | "userId" | "role">, inspectorId: string | null): boolean {
  return mayActOnThisInspection(me, inspectorId) && (isStaffRole(me.role) || me.canPublishCap);
}

export interface HubAccessInput {
  role: string;
  status: string;
  reportStatus: string;
  /** Money has been collected on this inspection (the server's own answer: invoice payments and held deposits count). */
  moneyCollected: boolean;
  /** `mayActOnThisInspection` for the viewer. */
  mayAct: boolean;
  /** For a cancelled inspection, the status it had before; null when unknown or not cancelled. */
  statusBeforeCancel: string | null;
}

export interface HubAccess {
  /** Booking fields: people, price, references, requirements. */
  canEditOrder: boolean;
  /** The inspector's own acts: marking the visit complete. */
  canEditInspection: boolean;
  /** Date and inspector. */
  canChangeSchedule: boolean;
  canCancel: boolean;
  canRestore: boolean;
  /** Switching a payment or agreement requirement off. */
  canTurnGateOff: boolean;
}

export function inspectionStartedForView(status: string, reportStatus: string): boolean {
  return status === INSPECTION_STATUS.COMPLETED || reportStatus !== REPORT_STATUS.IN_PROGRESS;
}

export function hubAccess({ role, status, reportStatus, moneyCollected, mayAct, statusBeforeCancel }: HubAccessInput): HubAccess {
  if (!isStaffRole(role)) {
    return { canEditOrder: true, canEditInspection: true, canChangeSchedule: true, canCancel: true, canRestore: true, canTurnGateOff: true };
  }
  const started = inspectionStartedForView(status, reportStatus);
  return {
    canEditOrder: mayAct,
    canEditInspection: false,
    canChangeSchedule: mayAct && !started,
    canCancel: mayAct && !started && !moneyCollected,
    // The server restores staff only to a status the cancellation recorded, and never a completed one.
    canRestore: mayAct && statusBeforeCancel !== null && statusBeforeCancel !== INSPECTION_STATUS.COMPLETED,
    canTurnGateOff: false,
  };
}
