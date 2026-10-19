import { Banner, Button, Card, formatFileSize } from "@core/shared-ui";
import type { PackageSummary } from "@core/offline-package";
import { formatDateTime, formatNumber } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * What a chosen package holds, read from its manifest in the browser.
 *
 * The manifest names no client and no address, only opaque ids and counts, so
 * this summary carries no personal information. Whether the package belongs to
 * this company is decided against the `tenantId` the loader took from the
 * signed-in session; the package's own claim is only ever compared to it, never
 * trusted as an identity. A mismatch disables the import: the server would
 * refuse it anyway, and refusing it here keeps the file from being sent.
 */
export function PackagePreview({
    summary, fileName, tenantId, locale, timeZone, error, onChooseOther, onReview,
}: {
    summary: PackageSummary;
    fileName: string;
    tenantId: string;
    locale: string;
    timeZone: string;
    error: string | null;
    onChooseOther: () => void;
    onReview: () => void;
}) {
    const { manifest, counts, bytes } = summary;
    const belongsHere = manifest.tenantId === tenantId;
    const fields: Array<[string, string]> = [
        [m.offline_import_field_exported_at(), formatDateTime(manifest.exportedAt, { locale, timeZone })],
        [m.offline_import_field_exported_by(), manifest.exportedBy],
        [m.offline_import_field_device(), manifest.deviceId],
        [m.offline_import_field_inspections(), formatNumber(counts.inspections, { locale })],
        [m.offline_import_field_changes(), formatNumber(counts.writes, { locale })],
        [m.offline_import_field_photos(), formatNumber(counts.photos, { locale })],
        [m.offline_import_field_size(), formatFileSize(bytes)],
    ];
    return (
        <Card className="p-5 space-y-4" data-testid="offline-package-preview">
            <div>
                <h2 className="text-[15px] font-bold text-ih-fg-1">{m.offline_import_preview_heading()}</h2>
                <p className="text-[13px] text-ih-fg-3 mt-0.5 break-all">{fileName}</p>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {fields.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                        <dt className="text-[12px] font-semibold text-ih-fg-3">{label}</dt>
                        <dd className="text-[14px] text-ih-fg-1 break-words">{value}</dd>
                    </div>
                ))}
            </dl>
            {belongsHere ? (
                <Banner tone="success">{m.offline_import_match_ok()}</Banner>
            ) : (
                <Banner tone="danger">{m.offline_import_match_bad()}</Banner>
            )}
            {error && <Banner tone="danger">{error}</Banner>}
            <p className="text-[12px] text-ih-fg-3">{m.offline_import_preview_note()}</p>
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={!belongsHere} onClick={onReview}>
                    {m.offline_import_action_review()}
                </Button>
                <Button variant="secondary" onClick={onChooseOther}>
                    {m.offline_import_action_other_file()}
                </Button>
            </div>
        </Card>
    );
}
