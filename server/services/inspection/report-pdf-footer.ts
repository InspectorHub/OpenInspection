/**
 * The three inputs the PDF running footer needs, resolved together.
 *
 * Lifted out of `inspection-report.service.ts` unchanged. It is a cohesive unit
 * — one lookup answering one question — and it is not payload assembly, which
 * is what the rest of that file is. The file is also at its large-file cap, and
 * the report-grain work needed room; splitting a whole unit is the answer to
 * that rather than raising the cap.
 *
 *  - `settings` — resolved tenant PDF settings (footer / page numbers / licence
 *    plus the company address) from `tenant_configs`. Default ON.
 *  - `address` — the inspection's property address, the footer's fallback when
 *    the tenant has configured no company address.
 *  - `license` — the assigned inspector's licence number, or null when there is
 *    no inspector or the credential carries no number.
 *
 * Every read filters by `tenantId`, so a footer can never print another
 * tenant's address or licence.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections, tenantConfigs } from '../../lib/db/schema';
import { CredentialService } from '../credential.service';
import { resolvePdfSettings, type PdfSettings } from '../../lib/pdf-settings';

export interface ReportPdfFooterContext {
    settings: PdfSettings;
    address: string;
    license: string | null;
}

export async function resolveReportPdfFooterContext(
    db: D1Database,
    inspectionId: string,
    tenantId: string,
): Promise<ReportPdfFooterContext> {
    const d = drizzle(db);

    const insp = await d
        .select({ propertyAddress: inspections.propertyAddress, inspectorId: inspections.inspectorId })
        .from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();

    const cfg = await d
        .select({
            companyAddress: tenantConfigs.companyAddress,
            pdfShowFooter: tenantConfigs.pdfShowFooter,
            pdfShowPageNumbers: tenantConfigs.pdfShowPageNumbers,
            pdfShowLicense: tenantConfigs.pdfShowLicense,
        })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();

    // The licence comes from the same source as the report payload's, so the
    // two can never print different numbers for the same inspector.
    const license: string | null = insp?.inspectorId
        ? await new CredentialService(db).primaryLicenseNumber(tenantId, insp.inspectorId)
        : null;

    return {
        settings: resolvePdfSettings(cfg),
        address: insp?.propertyAddress ?? '',
        license,
    };
}
