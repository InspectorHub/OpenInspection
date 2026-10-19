import { Banner, Button, Card, StatCard } from "@core/shared-ui";
import type { ImportReport } from "@core/offline-package";
import { HeldBackList } from "~/components/offline-package/HeldBackList";
import { formatNumber } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * The outcome of an import, in three numbers and then the detail behind the
 * third.
 *
 * "Needs attention" is two different things, kept in two lists: queued changes
 * the server refused (their inspection's results and photos still arrived, so
 * this is not a failure of the import) and inspections that were left behind
 * (listed with a reason and a download). A queued-write refusal is never
 * counted as a failed import.
 */
export function ImportResultPanel({
    report, locale, getOriginal, onAgain, onAnother,
}: {
    report: ImportReport;
    locale: string;
    getOriginal: () => Uint8Array | null;
    onAgain: () => void;
    onAnother: () => void;
}) {
    const attention = report.needsAttention.length + report.heldBack.length;
    const nothingChanged = report.imported.length > 0 && report.heldBack.length === 0 && report.applied === 0
        && report.skipped > 0 && report.needsAttention.length === 0;
    const banner = report.heldBack.length > 0
        ? (report.imported.length === 0
            ? <Banner tone="danger">{m.offline_import_result_none_imported()}</Banner>
            : null)
        : nothingChanged
            ? <Banner tone="info">{m.offline_import_result_all_skipped()}</Banner>
            : report.needsAttention.length === 0
                ? <Banner tone="success">{m.offline_import_result_all_imported()}</Banner>
                : null;
    return (
        <div className="space-y-ih-list" data-testid="offline-package-result">
            <Card className="p-5 space-y-4">
                <h2 className="text-[15px] font-bold text-ih-fg-1">{m.offline_import_result_heading()}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <StatCard tone="sat" label={m.offline_import_stat_imported()} value={formatNumber(report.imported.length, { locale })} hint={m.offline_import_stat_imported_hint()} />
                    <StatCard tone="neutral" label={m.offline_import_stat_skipped()} value={formatNumber(report.skipped, { locale })} hint={m.offline_import_stat_skipped_hint()} />
                    <StatCard tone={attention > 0 ? "monitor" : "neutral"} label={m.offline_import_stat_attention()} value={formatNumber(attention, { locale })} hint={m.offline_import_stat_attention_hint()} />
                </div>
                {banner}
                <div className="flex flex-wrap gap-2">
                    {report.heldBack.length > 0 && (
                        <Button variant="primary" onClick={onAgain}>{m.offline_import_action_again()}</Button>
                    )}
                    <Button variant="secondary" onClick={onAnother}>{m.offline_import_action_another()}</Button>
                </div>
            </Card>

            {report.needsAttention.length > 0 && (
                <Card className="p-5 space-y-3" data-testid="offline-package-attention">
                    <div>
                        <h2 className="text-[15px] font-bold text-ih-fg-1">{m.offline_import_attention_heading()}</h2>
                        <p className="text-[13px] text-ih-fg-3 mt-0.5">{m.offline_import_attention_intro()}</p>
                    </div>
                    <ul className="divide-y divide-ih-border rounded-ih-card border border-ih-border">
                        {report.needsAttention.map((row) => (
                            <li key={row.idempotencyKey} className="px-3 py-2.5">
                                <p className="text-[13px] font-semibold text-ih-fg-1 break-all">
                                    {m.offline_import_attention_row({ op: row.op, id: row.inspectionId })}
                                </p>
                                <p className="text-[12px] text-ih-fg-3 mt-0.5">
                                    {m.offline_import_attention_status({ status: row.status })}
                                    {row.reason ? ` - ${m.offline_import_attention_reason({ reason: row.reason })}` : ""}
                                </p>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            {report.heldBack.length > 0 && <HeldBackList rows={report.heldBack} getOriginal={getOriginal} />}
        </div>
    );
}
