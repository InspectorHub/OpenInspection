import { Card } from "@core/shared-ui";
import type { ImportProgress } from "~/hooks/useOfflinePackageImport";
import { m } from "~/paraglide/messages";

/**
 * Progress of an import that sends its parts one after another. Counted in
 * inspections (a fixed number the package names), not in parts: the number of
 * parts grows while it runs, because a refusal cuts the named inspection away
 * and the rest is sent again.
 */
export function ImportProgressPanel({ progress }: { progress: ImportProgress }) {
    const percent = Math.round((progress.done / progress.total) * 100);
    return (
        <Card className="p-5 space-y-3" data-testid="offline-package-progress">
            <h2 className="text-[15px] font-bold text-ih-fg-1">{m.offline_import_progress_heading()}</h2>
            <p className="text-[14px] text-ih-fg-1" aria-live="polite">
                {m.offline_import_progress_inspections({ done: progress.done, total: progress.total })}
            </p>
            <div
                role="progressbar"
                aria-label={m.offline_import_progress_aria()}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                className="h-2 w-full rounded-full bg-ih-bg-muted overflow-hidden"
            >
                <div className="h-full bg-ih-primary transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(percent, 4)}%` }} />
            </div>
            <p className="text-[13px] text-ih-fg-2">
                {m.offline_import_progress_counts({ imported: progress.imported, held: progress.heldBack })}
            </p>
            <p className="text-[12px] text-ih-fg-3">{m.offline_import_progress_note()}</p>
        </Card>
    );
}
