import { useState } from "react";
import { Button, Card, Modal, buttonClasses } from "@core/shared-ui";
import { StatutoryFormNotice } from "./StatutoryFormNotice";

/**
 * The statutory form, and the notice that has to be seen before it.
 *
 * -- NO SILENT STATUTORY FORM ------------------------------------------------
 * The download link does not exist outside an OPEN modal that is displaying the
 * notice. That ordering is the whole component: a plain download control beside
 * the other deliverables would hand somebody a state document without their
 * ever seeing what we declared about who produced it and who is responsible for
 * it.
 *
 * The gate is deliberately per-download rather than remembered. Acknowledgement
 * is not consent being recorded -- nothing is written down, and nothing should
 * be, because this is not a permission the reader is granting. It is a notice
 * they are being shown, and showing it again next time costs one click and
 * removes any question about whether they saw it for THIS form.
 *
 * -- THE PRIMARY BUTTON IS THE DOWNLOAD, AND THERE IS NO SECOND CLICK --------
 * This component used to hold an `acknowledged` flag: the modal's primary said
 * `Continue`, set the flag, closed, and swapped the page's button for a link
 * the reader then had to FIND and click. Two problems, and the second is the
 * one that mattered.
 *
 *   1. `Continue` does not carry the verb from the dialog's own title. The
 *      title is "Before you download this statutory form"; a reader should be
 *      able to read the button alone and know what happens.
 *   2. The flag made the sentence four paragraphs up FALSE. Once acknowledged,
 *      the link stayed on the page for the rest of the render and every
 *      subsequent download showed the reader nothing. "Showing it again next
 *      time costs one click" was true only of the first time.
 *
 * Deleting the flag fixes both and is strictly STRICTER than what it replaced:
 * with no remembered state there is no reachable download that is not inside a
 * modal currently rendering the notice.
 *
 * -- A REAL LINK, NOT A SCRIPTED DOWNLOAD ------------------------------------
 * The primary IS the `<a href>`, styled as one. Navigating from the user's own
 * click keeps the gesture -- a script-triggered download in an onClick handler
 * is what popup blockers stop, and it would fail silently when they do.
 *
 * -- IT BRINGS ITS OWN CARD --------------------------------------------------
 * Every other block on the inspection hub is a Card; this one was a lone button
 * in a bare `<div>` between the card grid and the documents section, and read
 * as an unfinished one. The Card lives HERE rather than at the call site so the
 * next place that renders a statutory form cannot forget it.
 *
 * ⚠️ It must NOT be folded into `DocumentsSection`. That section is for
 * documents a user UPLOADED, with a visibility toggle and a delete. A statutory
 * form is GENERATED and must not be deletable; sitting it among uploads would
 * imply it can be managed like one.
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
    /** The authority's own title for the form, verbatim. Never `formId`. */
    formTitle: string;
    revision: string;
    effectiveDate: string;
    /** Rendered server-side from the statutory disclaimer module. */
    notice: string;
    /** The download URL for this inspection's form. */
    href: string;
}

export function StatutoryDeliverable({
    formTitle,
    revision,
    effectiveDate,
    notice,
    href,
}: StatutoryDeliverableProps) {
    const [open, setOpen] = useState(false);

    return (
        <Card className="mb-4 p-5">
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                Statutory form
            </Button>

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
                        <a
                            className={buttonClasses({ variant: "primary", size: "md" })}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpen(false)}
                        >
                            Download statutory form
                        </a>
                    </>
                }
            >
                <StatutoryFormNotice
                    formTitle={formTitle}
                    revision={revision}
                    effectiveDate={effectiveDate}
                    notice={notice}
                />
            </Modal>
        </Card>
    );
}
