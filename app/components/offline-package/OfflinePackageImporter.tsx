import { useState } from "react";
import { Banner, Card, FileDropzone, formatFileSize, useActionLatch } from "@core/shared-ui";
import { IMPORT_LIMIT_CEILINGS, type ImportOptions } from "@core/offline-package";
import { ConfirmImportDialog } from "~/components/offline-package/ConfirmImportDialog";
import { ImportProgressPanel } from "~/components/offline-package/ImportProgressPanel";
import { ImportResultPanel } from "~/components/offline-package/ImportResultPanel";
import { PackagePreview } from "~/components/offline-package/PackagePreview";
import { useOfflinePackageImport } from "~/hooks/useOfflinePackageImport";
import { m } from "~/paraglide/messages";

/**
 * The single-page flow: choose, preview, confirm, import, result.
 *
 * The import is a component-level request series (see `useOfflinePackageImport`
 * for why it is not an action), so the same-frame guard is here: `latch` lets the
 * confirm click through once, and a second click that lands before `running` has
 * rendered is dropped. The dialog closes in the same handler.
 *
 * `tenantId` is the company of the signed-in session, taken by the loader. The
 * package's own `tenantId` is compared to it and never used as an identity.
 */
export function OfflinePackageImporter({
    tenantId, locale, timeZone, importOptions,
}: {
    tenantId: string;
    locale: string;
    timeZone: string;
    /** Test seam: lets a spec skip the real waits between retries. */
    importOptions?: ImportOptions;
}) {
    const { state, choose, reset, start, bytes } = useOfflinePackageImport(importOptions);
    const [confirming, setConfirming] = useState(false);
    const latch = useActionLatch(state.kind === "running");

    const confirm = (): void => latch(() => {
        setConfirming(false);
        void start();
    });

    return (
        <div className="space-y-ih-list">
            {state.kind === "idle" && (
                <Card className="p-5 space-y-4">
                    <h2 className="text-[15px] font-bold text-ih-fg-1">{m.offline_import_choose_heading()}</h2>
                    <FileDropzone
                        accept=".zip,application/zip,application/x-zip-compressed"
                        hint={m.offline_import_choose_hint({ size: formatFileSize(IMPORT_LIMIT_CEILINGS.compressedBytes) })}
                        error={state.error}
                        onFile={(file) => { void choose(file); }}
                    />
                    <Banner tone="info">{m.offline_import_privacy_note()}</Banner>
                    {state.error === null && (
                        <div>
                            <h3 className="text-[14px] font-bold text-ih-fg-2">{m.offline_import_choose_empty_title()}</h3>
                            <p className="text-[13px] text-ih-fg-3 mt-1 max-w-[62ch]">{m.offline_import_choose_empty_body()}</p>
                        </div>
                    )}
                </Card>
            )}

            {state.kind === "preview" && (
                <>
                    <PackagePreview
                        summary={state.summary}
                        fileName={state.fileName}
                        tenantId={tenantId}
                        locale={locale}
                        timeZone={timeZone}
                        error={state.error}
                        onChooseOther={reset}
                        onReview={() => setConfirming(true)}
                    />
                    <ConfirmImportDialog open={confirming} summary={state.summary} onConfirm={confirm} onCancel={() => setConfirming(false)} />
                </>
            )}

            {state.kind === "running" && <ImportProgressPanel progress={state.progress} />}

            {state.kind === "done" && (
                <ImportResultPanel
                    report={state.report}
                    locale={locale}
                    getOriginal={() => bytes.current}
                    onAgain={() => latch(() => { void start(); })}
                    onAnother={reset}
                />
            )}
        </div>
    );
}
