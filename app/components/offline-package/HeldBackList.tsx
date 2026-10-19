import { useState } from "react";
import { Banner, Button, Card, Pill } from "@core/shared-ui";
import type { HeldBack } from "@core/offline-package";
import { answerText, groupHeldBack } from "~/lib/offline-package-copy";
import { downloadHeldBackPackage } from "~/lib/offline-package-download";
import { m } from "~/paraglide/messages";

/**
 * Inspections an import did not bring in, grouped by why.
 *
 * A refusal of the whole package would otherwise print the same paragraph once
 * per inspection, so each distinct explanation is written once and the
 * inspections it applies to are listed under it. Every row still names its own
 * reason (the pill) and the status and code of the server answer behind it, and
 * every row, and every group, can be downloaded as a package of its own.
 * Nothing here is lost data: the original file is untouched, and a held-back
 * inspection is still in it.
 *
 * Inspection ids are shown as the opaque ids they are; the manifest holds no
 * names.
 */
export function HeldBackList({ rows, getOriginal }: { rows: readonly HeldBack[]; getOriginal: () => Uint8Array | null }) {
    const [downloadError, setDownloadError] = useState(false);

    function download(ids: readonly string[]): void {
        const original = getOriginal();
        try {
            if (!original) throw new Error("package no longer in memory");
            downloadHeldBackPackage(original, ids);
            setDownloadError(false);
        } catch {
            setDownloadError(true);
        }
    }

    return (
        <Card className="p-5 space-y-4" data-testid="offline-package-held-back">
            <div>
                <h2 className="text-[15px] font-bold text-ih-fg-1">{m.offline_import_held_heading()}</h2>
                <p className="text-[13px] text-ih-fg-3 mt-0.5">{m.offline_import_held_intro()}</p>
            </div>
            {downloadError && <Banner tone="danger">{m.offline_import_download_failed()}</Banner>}
            {groupHeldBack(rows).map(({ explanation, rows: groupRows }) => (
                <section key={explanation.group} className="border-t border-ih-border pt-4 space-y-2" data-testid={`held-back-group-${explanation.group}`}>
                    <p className="text-[14px] font-semibold text-ih-fg-1">{explanation.what}</p>
                    <p className="text-[13px] text-ih-fg-2">{explanation.next}</p>
                    <ul className="divide-y divide-ih-border rounded-ih-card border border-ih-border">
                        {groupRows.map((row) => {
                            const answer = answerText(row);
                            return (
                                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" data-testid="held-back-row">
                                    <div className="min-w-0 flex-1 basis-56">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[13px] font-semibold text-ih-fg-1 break-all">{m.offline_import_held_row({ id: row.id })}</span>
                                            <Pill tone={row.reason === "gave_up" ? "warning" : "defect"}>{explanation.label}</Pill>
                                        </div>
                                        <p className="text-[12px] text-ih-fg-3 mt-0.5">
                                            {answer ? m.offline_import_held_answer({ answer }) : m.offline_import_held_answer_none()}
                                            {row.detail && row.detail !== "local_error" ? ` - ${m.offline_import_held_detail({ detail: row.detail })}` : ""}
                                        </p>
                                    </div>
                                    <Button size="sm" variant="secondary" onClick={() => download([row.id])}>
                                        {m.offline_import_held_download()}
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                    {groupRows.length > 1 && (
                        <Button size="sm" variant="link" onClick={() => download(groupRows.map((r) => r.id))}>
                            {m.offline_import_held_download_group({ count: groupRows.length })}
                        </Button>
                    )}
                </section>
            ))}
        </Card>
    );
}
