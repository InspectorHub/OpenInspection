import { useState } from "react";
import { Button, Card } from "@core/shared-ui";
import { downloadLeftoverPackage } from "~/lib/offline-package-download";
import type { LeftoverPackage } from "~/lib/offline-package-leftovers";
import { m } from "~/paraglide/messages";

/**
 * The leftovers of the last import, still here after a reload (#485).
 *
 * The download is the recovery copy the import kept: the original file is
 * long gone, and this package holds only the inspections that were left
 * behind. Downloading does not clear it — the inspector may need it again —
 * and neither does choosing another file; only Discard, or a later import
 * that leaves nothing behind, removes it.
 */
export function LeftoverPackageCard({ leftover, onDiscard }: { leftover: LeftoverPackage; onDiscard: () => void }) {
    const [downloadError, setDownloadError] = useState(false);

    function download(): void {
        try {
            downloadLeftoverPackage(leftover.bytes, leftover.ids);
            setDownloadError(false);
        } catch {
            setDownloadError(true);
        }
    }

    return (
        <Card className="p-5 space-y-3" data-testid="offline-package-leftover">
            <div>
                <h2 className="text-[15px] font-bold text-ih-fg-1">{m.offline_import_leftover_heading()}</h2>
                <p className="text-[13px] text-ih-fg-3 mt-0.5">
                    {leftover.ids.length === 1
                        ? m.offline_import_leftover_body_one()
                        : m.offline_import_leftover_body_other({ count: leftover.ids.length })}
                </p>
            </div>
            {downloadError && <p className="text-[13px] text-ih-bad-fg">{m.offline_import_download_failed()}</p>}
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={download}>{m.offline_import_leftover_download()}</Button>
                <Button variant="secondary" onClick={onDiscard}>{m.offline_import_leftover_discard()}</Button>
            </div>
        </Card>
    );
}
