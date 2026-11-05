import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button, Modal, PENDING_CLASS, pendingProps } from "@core/shared-ui";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";
import { m } from "~/paraglide/messages";

interface RetractResult {
    ok?: boolean;
    error?: string;
}

const FORM_ID = "retract-report-form";

/**
 * Retract: take a published report back from clients. It is deliberately not "Edit and republish": that keeps the
 * last published version in front of clients while the inspector edits, and this withdraws the report and expires
 * every link they were sent. Because it cannot be undone by the inspector alone, it asks first, in a dialog that
 * says exactly that (never `window.confirm`).
 *
 * Posts `intent=unpublish` to the hub route's action, as the plain button it replaces did.
 */
export function RetractReportControl() {
    const fetcher = useFetcher<RetractResult>();
    const [open, setOpen] = useState(false);
    const latch = useSubmitLatch(fetcher.state);
    const busy = fetcher.state !== "idle";
    const done = fetcher.state === "idle" && fetcher.data?.ok === true;

    useEffect(() => {
        if (done) setOpen(false);
    }, [done]);

    const failure = fetcher.state === "idle" && fetcher.data?.ok === false ? fetcher.data.error : null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
            >
                {m.inspections_hub_report_unpublish()}
            </button>
            <Modal
                open={open}
                onClose={() => { if (!busy) setOpen(false); }}
                title={m.inspections_hub_retract_title()}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => { if (!busy) setOpen(false); }}>{m.inspections_hub_retract_cancel()}</Button>
                        <button
                            type="submit"
                            form={FORM_ID}
                            {...pendingProps(busy)}
                            className={`px-3 py-2 rounded-ih-button bg-ih-bad text-ih-fg-inverse text-sm font-bold ${PENDING_CLASS}`}
                        >
                            {busy ? m.inspections_hub_report_unpublishing() : m.inspections_hub_retract_confirm()}
                        </button>
                    </>
                }
            >
                <fetcher.Form id={FORM_ID} method="post" onSubmit={latch()}>
                    <input type="hidden" name="intent" value="unpublish" />
                    <p className="text-sm text-ih-fg-2">{m.inspections_hub_retract_body()}</p>
                </fetcher.Form>
                {failure && <p className="mt-3 text-sm text-ih-bad-fg" role="alert">{failure}</p>}
            </Modal>
        </>
    );
}
