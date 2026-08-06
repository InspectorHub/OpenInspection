import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

const ServiceSchema = z.object({
    id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId:        z.string().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    name:            z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    description:     z.string().nullable().describe('TODO describe description field for the OpenInspection MCP integration'),
    price:           z.number().int().describe('TODO describe price field for the OpenInspection MCP integration'),
    durationMinutes: z.number().int().nullable().describe('TODO describe durationMinutes field for the OpenInspection MCP integration'),
    templateId:      z.string().nullable().describe('TODO describe templateId field for the OpenInspection MCP integration'),
    agreementId:     z.string().nullable().describe('TODO describe agreementId field for the OpenInspection MCP integration'),
    active:          z.boolean().describe('TODO describe active field for the OpenInspection MCP integration'),
    sortOrder:       z.number().int().describe('TODO describe sortOrder field for the OpenInspection MCP integration'),
    createdAt:       z.string().nullable().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Service');

export const CreateServiceSchema = z.object({
    name:            z.string().min(1).max(200).describe('TODO describe name field for the OpenInspection MCP integration'),
    description:     z.string().max(1000).optional().describe('TODO describe description field for the OpenInspection MCP integration'),
    price:           z.number().int().min(0).describe('TODO describe price field for the OpenInspection MCP integration'),
    durationMinutes: z.number().int().min(0).optional().describe('TODO describe durationMinutes field for the OpenInspection MCP integration'),
    templateId:      z.string().optional().describe('TODO describe templateId field for the OpenInspection MCP integration'),
    agreementId:     z.string().optional().describe('TODO describe agreementId field for the OpenInspection MCP integration'),
    sortOrder:       z.number().int().optional().describe('TODO describe sortOrder field for the OpenInspection MCP integration'),
}).openapi('CreateService');

export const UpdateServiceSchema = CreateServiceSchema.partial().extend({
    active: z.boolean().optional().describe('TODO describe active field for the OpenInspection MCP integration'),
}).openapi('UpdateService');

export const CreateDiscountCodeSchema = z.object({
    code:      z.string().min(1).max(50).describe('TODO describe code field for the OpenInspection MCP integration'),
    type:      z.enum(['fixed', 'percent']).describe('TODO describe type field for the OpenInspection MCP integration'),
    value:     z.number().int().min(1).describe('TODO describe value field for the OpenInspection MCP integration'),
    maxUses:   z.number().int().min(1).optional().describe('TODO describe maxUses field for the OpenInspection MCP integration'),
    expiresAt: z.string().datetime().optional().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
}).openapi('CreateDiscountCode');

export const UpdateDiscountCodeSchema = z.object({
    code:      z.string().min(1).max(50).optional().describe('TODO describe code field for the OpenInspection MCP integration'),
    type:      z.enum(['fixed', 'percent']).optional().describe('TODO describe type field for the OpenInspection MCP integration'),
    value:     z.number().int().min(0).optional().describe('TODO describe value field for the OpenInspection MCP integration'),
    maxUses:   z.number().int().min(0).nullable().optional().describe('TODO describe maxUses field for the OpenInspection MCP integration'),
    expiresAt: z.string().nullable().optional().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
    active:    z.boolean().optional().describe('TODO describe active field for the OpenInspection MCP integration'),
}).openapi('UpdateDiscountCode');

export const ValidateDiscountSchema = z.object({
    code:     z.string().min(1).describe('TODO describe code field for the OpenInspection MCP integration'),
    subtotal: z.number().int().min(0).describe('TODO describe subtotal field for the OpenInspection MCP integration'),
}).openapi('ValidateDiscount');

export const ValidateDiscountResponseSchema = z.object({
    valid:          z.boolean().describe('TODO describe valid field for the OpenInspection MCP integration'),
    discountAmount: z.number().int().describe('TODO describe discountAmount field for the OpenInspection MCP integration'),
    discountCodeId: z.string().nullable().describe('TODO describe discountCodeId field for the OpenInspection MCP integration'),
    message:        z.string().optional().describe('TODO describe message field for the OpenInspection MCP integration'),
}).openapi('ValidateDiscountResponse');

export const ServiceListResponseSchema = createApiResponseSchema(z.array(ServiceSchema));
export const ServiceResponseSchema     = createApiResponseSchema(ServiceSchema);

/* ------------------------------------------------------------------ */
/*  Service lines on an inspection (IA-87)                             */
/* ------------------------------------------------------------------ */

/**
 * IA-87 — `inspection_services` rows were written ONLY at inspection creation
 * (the booking flow, the new-inspection wizard, the concierge hold). Nothing
 * could add, reprice, or remove a line afterwards, so the hub's Services card
 * could display what was sold but never change it, and the only way to make an
 * unpriced inspection billable was to edit the denormalized `inspections.price`
 * cache from inside the report editor. These three schemas are the write face.
 */
export const AddInspectionServiceSchema = z.object({
    serviceId: z.string().min(1).describe('Catalog service (services.id) to add as a line on this inspection.'),
    priceOverrideCents: z.number().int().min(0).nullable().optional()
        .describe('Charge something other than the catalog price for this one inspection; null/omitted bills the snapshot.'),
}).openapi('AddInspectionService');

export const UpdateInspectionServiceSchema = z.object({
    priceOverrideCents: z.number().int().min(0).nullable()
        .describe('New line price for this inspection; null clears the override and reverts to the catalog snapshot.'),
}).openapi('UpdateInspectionService');

const InspectionServiceLineSchema = z.object({
    id:            z.string().describe('inspection_services row id.'),
    serviceId:     z.string().describe('Catalog service this line came from.'),
    nameSnapshot:  z.string().describe('Service name as it was when the line was added.'),
    priceSnapshot: z.number().int().describe('Catalog price in cents as it was when the line was added.'),
    priceOverride: z.number().int().nullable().describe('Per-inspection price override in cents, or null.'),
}).openapi('InspectionServiceLine');

export const InspectionServiceResponseSchema = createApiResponseSchema(InspectionServiceLineSchema);

// IA-26 — per-service inspector qualification
export const ServiceInspectorListResponseSchema = createApiResponseSchema(z.object({
    userIds: z.array(z.string()).describe('Restricted inspector user IDs; empty = all staff qualified'),
}));

export const SetServiceInspectorsSchema = z.object({
    userIds: z.array(z.string())
        .transform(a => [...new Set(a)])
        .describe('Full replacement list of inspector user IDs; empty array clears restriction; duplicates are silently deduplicated'),
}).openapi('SetServiceInspectors');

export const SetServiceInspectorsResponseSchema = createApiResponseSchema(z.object({
    count: z.number().int().describe('Number of restriction rows now in effect'),
}));

/* ------------------------------------------------------------------ */
/*  Pay rules — the switch that turns pay splits on (#278)             */
/* ------------------------------------------------------------------ */

/**
 * THE UNIT CONTRACT, stated once here because it is where money goes wrong.
 *
 * `service_pay_rules.value` is a DUAL-UNIT column: basis points when `type` is
 * a percentage, integer cents when it is `fixed`. That is defensible in the
 * schema (the column comment explains why a `_cents` suffix would be a lie half
 * the time) and indefensible on the wire, where the caller is a person or a
 * script with no view of the type/unit coupling. `60` meaning 0.6% when the
 * caller meant 60% is a hundredfold error that no type system catches.
 *
 * So `value` never appears on the wire. Each variant names its own unit
 * (`percentBps`, `amountCents`) and the objects are STRICT: a payload written
 * against the column — `{ type: 'percent', value: 6000 }` — is a 400 that names
 * the unexpected key, not a row stored in the wrong unit. Converting a human
 * percent server-side was the alternative and is worse: it puts two
 * representations of the same number in the system, and the off-by-100 moves
 * from the wire (where a strict schema catches it) into arithmetic (where
 * nothing does). The UI does the ×100 where a human can see the "%" beside it.
 *
 * `deductionCents` is meaningful ONLY for `percent_after_deduction`, where the
 * deduction comes off the top BEFORE the percentage. A `percent` rule carrying
 * one is ambiguous — the caller either wanted the other type or made a mistake —
 * so it is REFUSED rather than silently dropped, by `exactlyTheFieldsFor` below.
 *
 * NOT a `z.discriminatedUnion`, which is what this was first written as and is
 * the shape the rule naturally has. Measured: three strict members, plus the
 * three `.omit()` members of the update union, expand through hono/client into
 * an app-wide RPC type that takes `type-check:app` past its 8 GB heap — tsc
 * dies with "Ineffective mark-compacts near heap limit", with no error to read.
 * Verified by bisection: the same tree with these routes reverted type-checks
 * clean. One strict object with an exhaustive cross-field refinement enforces
 * the identical contract — the wire shape, the field names, the rejections and
 * the tests are all unchanged — at one plain object's type cost. If hono's RPC
 * inference ever gets cheaper, this is the place to put the union back.
 */
const PercentBps = z.number().int().min(1).max(10000)
    .describe(
        'Share of the line price in BASIS POINTS: 6000 = 60%, 1 = 0.01%, 10000 = 100%. '
        + 'NOT a human percent — sending 60 here means 0.6%. '
        + 'Capped at 10000 because above 100% the gross exceeds the line price for every '
        + 'roster size, so no such rule could ever pay out; the split ceiling itself is '
        + 'checked at populate time, not here.',
    );

const PayRuleTarget = z.string().min(1).nullable().optional()
    .describe(
        'The inspector this rule is written for. Omit or send null for the SERVICE DEFAULT, '
        + 'which applies to any inspector without a rule of their own. At most one default '
        + 'and one rule per inspector exist per service.',
    );

const PayRuleTypeEnum = z.enum(['percent', 'fixed', 'percent_after_deduction'])
    .describe(
        'percent = a straight share of the line price. fixed = a flat amount whatever the '
        + 'line costs. percent_after_deduction = a share of what is left after a fixed amount '
        + 'comes off the top (materials, a franchise fee).',
    );

/** Which fields each type requires, and — just as load-bearing — which it forbids. */
const FIELDS_BY_TYPE = {
    percent:                 { required: ['percentBps'],                   forbidden: ['amountCents', 'deductionCents'] },
    fixed:                   { required: ['amountCents'],                  forbidden: ['percentBps', 'deductionCents'] },
    percent_after_deduction: { required: ['percentBps', 'deductionCents'], forbidden: ['amountCents'] },
} as const;

// `| undefined` spelled out on each: the repo runs `exactOptionalPropertyTypes`,
// under which `percentBps?: number` means "absent, or a number" and refuses an
// explicit undefined — which is exactly what zod hands the refinement.
type PayRuleFields = {
    type: keyof typeof FIELDS_BY_TYPE;
    percentBps?: number | undefined;
    amountCents?: number | undefined;
    deductionCents?: number | undefined;
};

/**
 * Only what the refinement uses. `z.RefinementCtx` is generic over the value
 * being refined, so naming it here would pin this helper to ONE of the two
 * schemas and the other would stop compiling — the whole point is that both
 * share it.
 */
interface IssueSink {
    addIssue: (issue: { code: 'custom'; path: (string | number)[]; message: string }) => void;
}

function exactlyTheFieldsFor(v: PayRuleFields, ctx: IssueSink) {
    const spec = FIELDS_BY_TYPE[v.type];
    for (const key of spec.required) {
        if (v[key] === undefined) {
            ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when type is "${v.type}".` });
        }
    }
    for (const key of spec.forbidden) {
        if (v[key] !== undefined) {
            ctx.addIssue({
                code: 'custom', path: [key],
                message: `${key} is not meaningful when type is "${v.type}" — remove it, or change the type.`,
            });
        }
    }
}

const payRuleRateFields = {
    type:       PayRuleTypeEnum,
    percentBps: PercentBps.optional(),
    amountCents: z.number().int().min(1).optional()
        .describe('Flat amount in integer cents: 12500 = $125.00. Only on a fixed rule.'),
    deductionCents: z.number().int().min(1).optional()
        .describe(
            'Taken off the line price BEFORE the percentage — materials, a franchise fee. '
            + '($500 − $100) × 60% = $240, which is not 60% of $500 less $100. '
            + 'Only on a percent_after_deduction rule; sending it with any other type is a 400.',
        ),
};

export const CreatePayRuleSchema = z.object({ ...payRuleRateFields, userId: PayRuleTarget })
    .strict()
    .openapi('CreatePayRule')
    .superRefine(exactlyTheFieldsFor)
    .describe('What one inspector earns on one catalogue service. See the unit contract above.');

/** Same shape minus the target: `userId` identifies the rule, so moving it is a delete + create. */
export const UpdatePayRuleSchema = z.object(payRuleRateFields)
    .strict()
    .openapi('UpdatePayRule')
    .superRefine(exactlyTheFieldsFor)
    .describe('Replace the rate of an existing pay rule. The inspector it applies to cannot be changed here.');

/** The read face mirrors the write face — again, no `value`. */
const PayRuleSchema = z.object({
    id:             z.string().describe('service_pay_rules row id.'),
    serviceId:      z.string().describe('Catalogue service this rule prices the work on.'),
    userId:         z.string().nullable().describe('Inspector this rule is for; null is the service default.'),
    type:           z.enum(['percent', 'fixed', 'percent_after_deduction']).describe('Which of the three rate shapes this is.'),
    percentBps:     z.number().int().nullable().describe('Basis points, on the two percentage types; null on a fixed rule.'),
    amountCents:    z.number().int().nullable().describe('Integer cents, on a fixed rule; null on the percentage types.'),
    deductionCents: z.number().int().nullable().describe('Cents off the top, only on percent_after_deduction.'),
    createdAt:      z.string().nullable().describe('When the rule was written, ISO-8601.'),
}).openapi('PayRule');

export const PayRuleResponseSchema     = createApiResponseSchema(PayRuleSchema);
export const PayRuleListResponseSchema = createApiResponseSchema(z.array(PayRuleSchema));
