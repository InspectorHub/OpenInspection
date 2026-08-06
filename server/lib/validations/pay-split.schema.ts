import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Pay splits over HTTP (#278).
 *
 * The naming here is load-bearing and is NOT interchangeable. `amountCents` is
 * the WORKER'S PAY. The company-side figure — what the business billed for the
 * work — is "attributed revenue" and lives in the metrics payload, never in
 * this one. Housecall Pro calls the worker's money `Commission Cost`, which is
 * safe there because only an owner ever opens that report; an inspector opens
 * THIS one, so "cost" is not a word this surface may use.
 */
const PaySplitSchema = z.object({
    id:                  z.string().describe('Pay split row id.'),
    inspectionServiceId: z.string().describe('Billing line (inspection_services.id) this pay attaches to.'),
    userId:              z.string().describe('Staff member the pay is owed to.'),
    amountCents:         z.number().int().describe('Pay owed to this inspector on this line, in integer cents.'),
    source:              z.enum(['rule', 'manual']).describe('Whether a tenant pay rule populated this row or a human set it.'),
    lockedAtMs:          z.number().int().nullable().describe('Epoch ms this row was locked by a payroll export; null while still editable.'),
    correctsSplitId:     z.string().nullable().describe('Set on a correction row; the locked split it carries a delta against.'),
    reason:              z.string().nullable().describe('Why a human moved this number — the audit answer for a disputed payout.'),
    createdAtMs:         z.number().int().describe('Epoch ms the row was created.'),
    updatedAtMs:         z.number().int().describe('Epoch ms the row last changed.'),
});

const PaySplitListSchema = z.object({
    /**
     * False for an inspector reading their own row. The list is already scoped
     * to them by the query, so this drives the UI rather than the security —
     * the rows a `financial: false` caller may not see are absent, not hidden.
     */
    canEdit: z.boolean().describe('Whether the caller may change these amounts (the financial capability).'),
    scope:   z.enum(['all', 'self']).describe('Whether the rows cover everyone on the inspection or only the caller.'),
    splits:  z.array(PaySplitSchema).describe('Pay rows for the active billing lines of this inspection.'),
});

export const SetPaySplitSchema = z.object({
    amountCents: z.number().int().min(0).describe('The agreed pay for this inspector on this line, in integer cents.'),
    reason:      z.string().trim().min(1).max(500).optional().describe('Why the amount was changed, kept for payout disputes.'),
});

export const CorrectPaySplitSchema = z.object({
    amountCents: z.number().int().describe('The DELTA against the locked split, in integer cents; may be negative.'),
    reason:      z.string().trim().min(1).max(500).describe('Why the exported amount is being corrected.'),
});

const RefreshPreviewSchema = z.object({
    changes: z.array(z.object({
        splitId:             z.string().describe('Pay split row that would change.'),
        userId:              z.string().describe('Staff member whose pay would move.'),
        inspectionServiceId: z.string().describe('Billing line the row belongs to.'),
        from:                z.number().int().describe('Current pay in integer cents.'),
        to:                  z.number().int().describe('Pay the current rules and roster would produce, in integer cents.'),
    })).describe('What an explicit refresh would change, before anything changes.'),
});

const RefreshResultSchema = z.object({
    changed: z.number().int().describe('How many existing pay rows the refresh moved.'),
});

const PayrollExportSchema = z.object({
    fromMs: z.number().int().describe('Epoch ms of the first instant in the payroll period, inclusive.'),
    toMs:   z.number().int().describe('Epoch ms of the last instant in the payroll period, inclusive.'),
});

const PayrollRunSchema = z.object({
    lockedCount: z.number().int().describe('How many pay rows this export locked.'),
    totalCents:  z.number().int().describe('Total pay locked by this export, in integer cents.'),
    splits:      z.array(PaySplitSchema).describe('The pay rows this export locked, now read-only.'),
});

export const PaySplitListResponseSchema  = createApiResponseSchema(PaySplitListSchema);
export const RefreshPreviewResponseSchema = createApiResponseSchema(RefreshPreviewSchema);
export const RefreshResultResponseSchema  = createApiResponseSchema(RefreshResultSchema);
export const PaySplitResponseSchema       = createApiResponseSchema(PaySplitSchema);
export const PayrollRunResponseSchema     = createApiResponseSchema(PayrollRunSchema);
export { PayrollExportSchema };
