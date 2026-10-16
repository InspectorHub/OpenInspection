/**
 * Which part of an inspection record is the ORDER (booking, people, money, schedule)
 * and which part is the INSPECTION itself (what is found, how the report looks, who
 * signs it).
 *
 * One record carries both, so the line between them is drawn here, once, and every
 * caller reads it from here: the PATCH guard that decides what an office user
 * (staff) may write, the cancel and restore rules, and the tests that walk the
 * request schema key by key. Nothing else lists these fields.
 *
 * Fail closed: a key that is not named below is an inspection-side key, and an
 * office user is refused it. Adding a field to `UpdateInspectionSchema` without
 * classifying it turns `order-fields.spec.ts` red.
 */
import { INSPECTION_STATUS } from '../status/inspection-status';
import { REPORT_STATUS } from '../status/report-status';

/** Booking, schedule, people-facing facts and delivery requirements. Office users may write these. */
export const ORDER_FIELDS = [
    'date',
    'inspectorId',
    'price',
    'depositRequiredCents',
    'paymentRequired',
    'agreementRequired',
    'referenceNumber',
    'referralSource',
    'referredByContactId',
    'closingDate',
    'propertyAddress',
    'status',
] as const;

/**
 * Facts about the property. They belong to the office until the inspection starts
 * (the booking is still being filled in), and to the inspection afterwards.
 */
export const ATTRIBUTE_FIELDS = [
    'yearBuilt',
    'sqft',
    'foundationType',
    'bedrooms',
    'bathrooms',
    'lotSize',
    'unit',
    'county',
    'propertyType',
    'templateId',
] as const;

/** Report look and the signature switch. Never written by an office user. */
export const INSPECTION_SIDE_FIELDS = [
    'coverPhotoId',
    'profileOverride',
    'badgeLayoutOverride',
    'reportPhotoColumns',
    'requireDefectFieldsOverride',
    'autoSignOnPublish',
] as const;

/** The statuses an office user may write: a booking that has not been worked yet. */
export const STAFF_ORDER_STATUSES = [INSPECTION_STATUS.REQUESTED, INSPECTION_STATUS.SCHEDULED, INSPECTION_STATUS.CONFIRMED] as const;

/** Once the inspection has started, an office user may no longer change who, where or when. */
export const LOCKED_AFTER_SUBMIT = ['inspectorId', 'propertyAddress', 'date'] as const;

/** Delivery requirements an office user may switch on and may not switch off. */
export const GATE_FIELDS = ['paymentRequired', 'agreementRequired'] as const;

const ORDER_SET: ReadonlySet<string> = new Set(ORDER_FIELDS);
const ATTRIBUTE_SET: ReadonlySet<string> = new Set(ATTRIBUTE_FIELDS);
const LOCKED_SET: ReadonlySet<string> = new Set(LOCKED_AFTER_SUBMIT);
const GATE_SET: ReadonlySet<string> = new Set(GATE_FIELDS);

export type FieldSide = 'order' | 'attribute' | 'inspection';

/** Which side a PATCH key sits on. A key nobody named is on the inspection side. */
export function sideOf(key: string): FieldSide {
    if (ORDER_SET.has(key)) return 'order';
    if (ATTRIBUTE_SET.has(key)) return 'attribute';
    return 'inspection';
}

/**
 * Has the inspection itself begun? Any one of: the report has left `in_progress`,
 * the visit is marked completed, or the results row holds a key.
 *
 * `hasResultKeys` is what D1 says, and results are written by a collaborative
 * document that can lag behind an offline inspector. That is why the other two
 * signals count on their own: once the report or the status moves past its start,
 * the answer is yes whatever the results row says.
 */
export function inspectionStarted(row: { status: string; reportStatus: string; hasResultKeys: boolean }): boolean {
    return row.reportStatus !== REPORT_STATUS.IN_PROGRESS || row.status === INSPECTION_STATUS.COMPLETED || row.hasResultKeys;
}

/**
 * Is the submitted date the stored one? Same calendar day, and when the submission
 * carries a time it must equal the stored instant: a stored date-only value has no
 * time, so a submitted time is a change. A date-only submission keeps the stored time.
 */
export function sameMoment(stored: unknown, submitted: string): boolean {
    const a = stored instanceof Date ? stored.toISOString() : String(stored ?? '');
    if (a.slice(0, 10) !== submitted.slice(0, 10)) return false;
    if (submitted.length <= 10) return true;
    return a.length > 10 && Date.parse(a) === Date.parse(submitted);
}

function sameValue(key: string, stored: unknown, submitted: unknown): boolean {
    if (key === 'date' && typeof submitted === 'string') return sameMoment(stored, submitted);
    return (stored ?? null) === (submitted ?? null);
}

/**
 * The keys of `body` whose value differs from the stored row. A settings form
 * forwards every field it holds, so repeating the stored value is not a change.
 * Without a stored row every key counts as changed.
 */
export function changedKeys(body: Record<string, unknown>, stored: Record<string, unknown> | undefined): string[] {
    return Object.keys(body).filter((key) => {
        if (body[key] === undefined) return false;
        return !stored || !sameValue(key, stored[key], body[key]);
    });
}

export interface StaffPatchState {
    status: string;
    reportStatus: string;
    /** The result of `inspectionStarted` for this record. */
    started: boolean;
    paymentRequired: boolean;
    agreementRequired: boolean;
    /** The stored row, for telling a repeated value from a change. Omit it and every key counts as changed. */
    stored?: Record<string, unknown>;
}

export type StaffPatchRefusal =
    | 'inspection_side_field'
    | 'attribute_locked'
    | 'started_locked'
    | 'status_regress'
    | 'status_not_order'
    | 'gate_off';

export type StaffPatchVerdict =
    | { ok: true; changed: string[] }
    | { ok: false; reason: StaffPatchRefusal; keys: string[] };

const REFUSAL_ORDER: readonly StaffPatchRefusal[] = [
    'inspection_side_field', 'attribute_locked', 'started_locked', 'status_regress', 'status_not_order', 'gate_off',
];

/**
 * What an office user's PATCH body may change. The whole body is refused if any one
 * changed key is refused; the verdict names the reason and the keys behind it.
 * Pure: the caller supplies the record's state and decides what to do with the verdict.
 */
export function classifyStaffPatch(body: Record<string, unknown>, current: StaffPatchState): StaffPatchVerdict {
    const changed = changedKeys(body, current.stored);
    const refused = new Map<StaffPatchRefusal, string[]>();
    const refuse = (reason: StaffPatchRefusal, key: string) => refused.set(reason, [...(refused.get(reason) ?? []), key]);

    for (const key of changed) {
        const side = sideOf(key);
        if (side === 'inspection') { refuse('inspection_side_field', key); continue; }
        if (side === 'attribute' && current.started) { refuse('attribute_locked', key); continue; }
        if (LOCKED_SET.has(key) && current.started) { refuse('started_locked', key); continue; }
        if (key === 'status') {
            // The completed visit is the inspector's. A cancelled record is answered by the
            // cancel and restore routes, which this guard leaves alone.
            if (current.status === INSPECTION_STATUS.COMPLETED) refuse('status_regress', key);
            else if (!(STAFF_ORDER_STATUSES as readonly string[]).includes(String(body[key]))) refuse('status_not_order', key);
            continue;
        }
        if (GATE_SET.has(key) && body[key] !== true) {
            const wasOn = key === 'paymentRequired' ? current.paymentRequired : current.agreementRequired;
            // Switching off a requirement that is already off removes nothing.
            if (wasOn || body[key] !== false) refuse('gate_off', key);
        }
    }

    for (const reason of REFUSAL_ORDER) {
        const keys = refused.get(reason);
        if (keys) return { ok: false, reason, keys };
    }
    return { ok: true, changed };
}
