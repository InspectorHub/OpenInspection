import { useEffect, useRef } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { Banner, Button } from "@core/shared-ui";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";
import { m } from "~/paraglide/messages";

/** Where a report stands for the editor: read off the inspection (see `reportState` in the editor loader). */
export interface ReportPublishState {
    /** The version clients read, or null when none is known. */
    publishedVersionNumber: number | null;
    /** A published report open for "Edit and republish": clients still read `publishedVersionNumber`. */
    editingAgain: boolean;
    /** The editor shows the report for reading only: it is published and not being edited again. */
    readOnly: boolean;
}

interface EditAgainResult {
    ok: boolean;
    error?: string;
}

interface ReportPublishBannerProps extends ReportPublishState {
    /** The live document was closed because the report was published from another device or tab. */
    locked: boolean;
    /** Opens the editor's own publish dialog (the one the header's Publish opens). */
    openPublish: () => void;
}

/**
 * What the editor says about a report that has gone out, and the one step that goes with it:
 *
 * - published and read-only: the report is the version clients see, and cannot change until the inspector chooses
 *   "Edit and republish" (nothing is withdrawn, no link expires);
 * - editing again: clients still see the last published version, and publishing the update makes the next one;
 * - locked: the report was published somewhere else while this page was open, so edits would be refused; reloading
 *   shows where it stands.
 *
 * Shows nothing for a report that was never published.
 */
export function ReportPublishBanner({ publishedVersionNumber, editingAgain, readOnly, locked, openPublish }: ReportPublishBannerProps) {
    const fetcher = useFetcher<EditAgainResult>();
    const revalidator = useRevalidator();
    const latch = useSubmitLatch(fetcher.state);
    const busy = fetcher.state !== "idle";
    const result = fetcher.state === "idle" ? fetcher.data : undefined;
    const revalidate = revalidator.revalidate;
    const revalidateRef = useRef(revalidate);
    revalidateRef.current = revalidate;

    // The editor's route skips revalidation after a POST, so leaving read-only is an explicit refresh of the loader.
    // Keyed on the result object itself (not on a boolean or on the revalidator, whose identity changes with every
    // revalidation): each successful answer refreshes the loader exactly once, never in a loop.
    useEffect(() => {
        if (result?.ok === true) void revalidateRef.current();
    }, [result]);

    const version = publishedVersionNumber;
    const failure = fetcher.state === "idle" && fetcher.data?.ok === false ? (fetcher.data.error ?? m.editor_publish_banner_error()) : null;

    if (locked && !readOnly) {
        return (
            <div className="mb-4">
                <Banner tone="warn" actions={<Button variant="secondary" size="sm" onClick={() => window.location.reload()}>{m.editor_publish_banner_reload()}</Button>}>
                    {m.editor_publish_banner_locked()}
                </Banner>
            </div>
        );
    }
    if (readOnly) {
        return (
            <div className="mb-4 space-y-2">
                <Banner
                    tone="info"
                    actions={
                        <fetcher.Form method="post" onSubmit={latch()}>
                            <input type="hidden" name="intent" value="edit-again" />
                            <Button type="submit" variant="primary" size="sm" pending={busy}>{m.editor_publish_banner_edit()}</Button>
                        </fetcher.Form>
                    }
                >
                    {version === null ? m.editor_publish_banner_published_no_version() : m.editor_publish_banner_published({ version })}
                </Banner>
                {failure && <Banner tone="danger">{failure}</Banner>}
            </div>
        );
    }
    if (editingAgain) {
        return (
            <div className="mb-4">
                <Banner tone="warn" actions={<Button variant="primary" size="sm" onClick={openPublish}>{m.editor_publish_banner_publish_update()}</Button>}>
                    {version === null ? m.editor_publish_banner_editing_no_version() : m.editor_publish_banner_editing({ version })}
                </Banner>
            </div>
        );
    }
    return null;
}
