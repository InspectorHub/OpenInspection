import { z } from 'zod';

/**
 * Lenient shapes for browser CSP violation reports. Browsers send two formats and
 * neither is under our control, so every field is optional and a field of the
 * wrong type becomes `undefined` instead of failing the whole report.
 *
 *   - legacy `report-uri`:  { "csp-report": { "blocked-uri": ..., ... } }
 *   - Reporting API:        [ { "type": "csp-violation", "body": { "blockedURL": ..., ... } } ]
 */
const text = z.string().optional().catch(undefined);
const count = z.number().optional().catch(undefined);

export const LegacyCspReportSchema = z.object({
    'csp-report': z.object({
        'document-uri': text,
        'blocked-uri': text,
        'effective-directive': text,
        'violated-directive': text,
        disposition: text,
        'source-file': text,
        'line-number': count,
        'column-number': count,
    }),
});

export const ReportingApiEntrySchema = z.object({
    type: text,
    body: z.object({
        documentURL: text,
        blockedURL: text,
        effectiveDirective: text,
        disposition: text,
        sourceFile: text,
        lineNumber: count,
        columnNumber: count,
    }).optional().catch(undefined),
});

export const ReportingApiCspReportSchema = z.array(ReportingApiEntrySchema);

export type LegacyCspReport = z.infer<typeof LegacyCspReportSchema>;
export type ReportingApiEntry = z.infer<typeof ReportingApiEntrySchema>;
