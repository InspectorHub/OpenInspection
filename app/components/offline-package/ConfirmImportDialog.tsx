import { Banner } from "@core/shared-ui";
import type { PackageSummary } from "@core/offline-package";
import { ConfirmDialog } from "@core/field-ui/components/ConfirmDialog";
import { m } from "~/paraglide/messages";

/**
 * The last step before anything is uploaded. It names what will be added and
 * says plainly that the file holds client personal information and is not
 * encrypted, because from here on the file is the company's to look after.
 * Confirming starts the import; the caller guards that call against a second
 * click in the same frame.
 */
export function ConfirmImportDialog({
    open, summary, onConfirm, onCancel,
}: {
    open: boolean;
    summary: PackageSummary;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const { counts } = summary;
    return (
        <ConfirmDialog
            open={open}
            tone="default"
            title={m.offline_import_confirm_title()}
            message={m.offline_import_confirm_body({ inspections: counts.inspections, changes: counts.writes, photos: counts.photos })}
            confirmLabel={m.offline_import_confirm_button()}
            onConfirm={onConfirm}
            onCancel={onCancel}
        >
            <Banner tone="warn" className="mt-3 font-normal!">{m.offline_import_confirm_privacy()}</Banner>
        </ConfirmDialog>
    );
}
