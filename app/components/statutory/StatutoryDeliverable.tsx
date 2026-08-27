import { useState } from "react";
import { Button, Modal, buttonClasses } from "@core/shared-ui";
import { StatutoryFormNotice } from "./StatutoryFormNotice";

/**
 * The statutory form, and the notice that has to be seen before it.
 *
 * -- NO SILENT STATUTORY FORM ------------------------------------------------
 * The download link does not exist until the notice has been shown and
 * acknowledged. That ordering is the whole component: a plain download control
 * beside the other deliverables would hand somebody a state document without
 * their ever seeing what we declared about who produced it and who is
 * responsible for it.
 *
 * The gate is deliberately per-render rather than remembered. Acknowledgement
 * is not consent being recorded -- nothing is written down, and nothing should
 * be, because this is not a permission the reader is granting. It is a notice
 * they are being shown, and showing it again next time costs one click and
 * removes any question about whether they saw it for THIS form.
 *
 * -- WHY THE NOTICE IS IN THE MODAL, NOT A LINK TO IT ------------------------
 * A modal saying "please review the notice" would satisfy every flow test while
 * showing the reader nothing. The text is rendered in place.
 *
 * -- Modal, not window.confirm -----------------------------------------------
 * `window.confirm` is prohibited here, and could not carry the notice anyway.
 * `Modal` from the shared library already handles focus, escape and the
 * backdrop, so none of that is re-implemented.
 */
export interface StatutoryDeliverableProps {
    formId: string;
    revision: string;
    effectiveDate: string;
    /** Rendered server-side from the statutory disclaimer module. */
    notice: string;
    /** The download URL for this inspection's form. */
    href: string;
}

export function StatutoryDeliverable({
    formId,
    revision,
    effectiveDate,
    notice,
    href,
}: StatutoryDeliverableProps) {
    const [open, setOpen] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    return (
        <>
            {acknowledged ? (
                <a
                    className={buttonClasses({ variant: "secondary", size: "sm" })}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Download statutory form
                </a>
            ) : (
                <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                    Statutory form
                </Button>
            )}

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Before you download this statutory form"
                size="lg"
                footer={
                    <>
                        <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            onClick={() => {
                                setAcknowledged(true);
                                setOpen(false);
                            }}
                        >
                            Continue
                        </Button>
                    </>
                }
            >
                <StatutoryFormNotice
                    formId={formId}
                    revision={revision}
                    effectiveDate={effectiveDate}
                    notice={notice}
                />
            </Modal>
        </>
    );
}
