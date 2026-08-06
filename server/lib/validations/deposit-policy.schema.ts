import { z } from '@hono/zod-openapi';

/**
 * The wire shape of a deposit policy — tier 1 (`UpdateBranding`) and tier 2
 * (`CreateService` / `UpdateService`) share it, because they are the same
 * question asked at two scopes and two schemas would drift.
 *
 * The unit lives in the FIELD NAME, never in a bare `value` whose meaning
 * depends on a sibling: `50` is half the price under one type and fifty cents
 * under another, and no type system objects. See `lib/billing/deposit-policy.ts`
 * for why this is one refined object rather than the discriminated union the
 * same reasoning would otherwise produce (measured `type-check:app` heap cost
 * through the hono/client RPC type — `service.schema.ts` records the incident).
 *
 * NOT `.strict()`: this object round-trips through settings forms that echo
 * back what they were given, and a stray key is not worth a 400. The refinement
 * below still refuses a value in the WRONG unit slot, which is the failure that
 * moves money.
 */
const FIELDS_BY_TYPE = {
    none:    { required: [],              forbidden: ['percent', 'amountCents'] },
    percent: { required: ['percent'],     forbidden: ['amountCents'] },
    fixed:   { required: ['amountCents'], forbidden: ['percent'] },
} as const;

// `| undefined` spelled out: the repo runs `exactOptionalPropertyTypes`, under
// which `percent?: number` refuses the explicit undefined zod hands a refinement.
interface DepositPolicyFields {
    type: keyof typeof FIELDS_BY_TYPE;
    percent?: number | undefined;
    amountCents?: number | undefined;
}

interface IssueSink {
    addIssue: (issue: { code: 'custom'; path: (string | number)[]; message: string }) => void;
}

function exactlyTheFieldsFor(v: DepositPolicyFields, ctx: IssueSink) {
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

export const DepositPolicySchema = z.object({
    type: z.enum(['none', 'percent', 'fixed'])
        .describe("none = charge nothing (as a per-service value, this OPTS OUT of the workspace default); percent = a share of the price; fixed = a flat amount."),
    percent: z.number().min(0).max(100).optional()
        .describe('Whole percent of the price, 0-100. Only on a percent policy.'),
    amountCents: z.number().int().min(0).optional()
        .describe('Flat amount in integer cents: 7500 = $75.00. Only on a fixed policy.'),
})
    .openapi('DepositPolicy')
    .superRefine(exactlyTheFieldsFor)
    .describe('Deposit asked for at booking. Never charges more than the price.');
