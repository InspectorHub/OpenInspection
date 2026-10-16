/**
 * What the inspection hub offers the viewer, in one place.
 *
 * The hub used to ask one question, "is this an office user?", and answer it for
 * every control. The server makes finer calls, so the page asks the same ones:
 *
 * - the BOOKING (people, price, requirements, references, cancelling a job nothing
 *   has been collected on) is open to office staff;
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
  /** Sending an already published report is not publishing it, so it has its own flag. */
  canSendReport: boolean;
  role: string;
  isAdmin: boolean;
}

/** The viewer's access from the `/auth/me` body. A missing or failed body resolves to the narrowest answer. */
export function meAccessFromBody(
  meBody: { data?: { user?: { role?: string }; capabilities?: { publish?: boolean; viewCommunication?: boolean; scheduleOthers?: boolean } } } | null,
): MeAccess {
  if (!meBody) return { canPublishCap: false, canViewCommunication: false, canSendReport: false, role: "inspector", isAdmin: false };
  const role = meBody.data?.user?.role ?? "inspector";
  const isAdmin = isAdminRole(role);
  return {
    canPublishCap: publishCapFromMe(meBody),
    canViewCommunication: viewCommunicationCapFromMe(meBody),
    // The server lets a user send a report on a job they work, or any job with scheduleOthers.
    canSendReport: isAdmin || role === "inspector" || meBody.data?.capabilities?.scheduleOthers === true,
    role,
    isAdmin,
  };
}

export interface HubAccessInput {
  role: string;
  status: string;
  reportStatus: string;
  /** Money has been collected on this inspection (an invoice paid, a deposit held). */
  moneyCollected: boolean;
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

export function hubAccess({ role, status, reportStatus, moneyCollected }: HubAccessInput): HubAccess {
  if (!isStaffRole(role)) {
    return { canEditOrder: true, canEditInspection: true, canChangeSchedule: true, canCancel: true, canRestore: true, canTurnGateOff: true };
  }
  const started = inspectionStartedForView(status, reportStatus);
  return {
    canEditOrder: true,
    canEditInspection: false,
    canChangeSchedule: !started,
    canCancel: !started && !moneyCollected,
    // A restore brings back the status the job had; one that had started may have been completed.
    canRestore: reportStatus === REPORT_STATUS.IN_PROGRESS,
    canTurnGateOff: false,
  };
}
