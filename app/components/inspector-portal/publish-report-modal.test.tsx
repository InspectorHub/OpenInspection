// @vitest-environment happy-dom
/**
 * The publish modal tells the inspector what is unresolved — and still lets
 * them publish.
 *
 * WHY BOTH HALVES ARE THE FEATURE:
 *
 *   1. IT SAYS SOMETHING. The hub card next to the Publish button counts
 *      unresolved items, but the modal that actually publishes said nothing
 *      about them, so the last screen before the irreversible act was the one
 *      screen with the least information. Publishing from the editor showed a
 *      list; publishing from the hub showed nothing. Same act, two answers.
 *   2. IT DOES NOT BLOCK. A completeness check is a reminder, not a
 *      precondition: an inspector may have good reason to publish with an item
 *      left open, so the count informs and the decision stays theirs. A
 *      disabled publish button here would take that decision away.
 *
 * The count is all THIS modal has: its payload carries `{ ready, blockingCount }`
 * and not the defects themselves. The list lives one step earlier — the
 * Publish button runs the readiness endpoint on demand and shows the editor's
 * PublishGateModal with the defects before this modal ever opens — so this
 * modal still shows the count, and the gate shows the list.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";
import type { FormHTMLAttributes } from "react";

import { PublishReportModal } from "~/components/inspector-portal/PublishReportModal";

afterEach(cleanup);

function renderModal(
    blockingCount: number,
    opts: { isAmendment?: boolean; noticeChoice?: boolean; autoSign?: boolean; orderCompleted?: boolean } = {},
) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component() {
                const fetcher = useFetcher();
                return (
                    <PublishReportModal
                        open
                        isAmendment={opts.isAmendment ?? false}
                        noticeChoice={opts.noticeChoice}
                        courtesyTranslationEnabled={false}
                        courtesyTranslationLocale="es-419"
                        clientPrefersTranslation={false}
                        autoSign={opts.autoSign ?? false}
                        // Completed by default: one publish button, so the
                        // existing /publish/i selectors stay unambiguous.
                        orderCompleted={opts.orderCompleted ?? true}
                        blockingCount={blockingCount}
                        fetcher={fetcher as never}
                        submitting={false}
                        error={undefined}
                        onClose={() => {}}
                    />
                );
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

type Fetcher = Parameters<typeof PublishReportModal>[0]["fetcher"];

function makeCapturingFetcher(onSubmitted: (data: FormData) => void): Fetcher {
    function Form({ onSubmit, ...rest }: FormHTMLAttributes<HTMLFormElement>) {
        return (
            <form
                {...rest}
                onSubmit={(e) => {
                    onSubmit?.(e);
                    if (!e.defaultPrevented) onSubmitted(new FormData(e.currentTarget));
                    e.preventDefault();
                }}
            />
        );
    }
    return { state: "idle", data: undefined, Form } as unknown as Fetcher;
}

function renderModalWithFetcher(
    opts: { isAmendment?: boolean; noticeChoice?: boolean; autoSign?: boolean; orderCompleted?: boolean; onPublishSubmit?: (choice: { offered: boolean; notified: boolean }) => void },
    onSubmitted: (data: FormData) => void,
) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component() {
                return (
                    <PublishReportModal
                        open
                        isAmendment={opts.isAmendment ?? false}
                        noticeChoice={opts.noticeChoice}
                        courtesyTranslationEnabled={false}
                        courtesyTranslationLocale="es-419"
                        clientPrefersTranslation={false}
                        autoSign={opts.autoSign ?? false}
                        orderCompleted={opts.orderCompleted ?? true}
                        blockingCount={0}
                        fetcher={makeCapturingFetcher(onSubmitted)}
                        submitting={false}
                        error={undefined}
                        onClose={() => {}}
                        onPublishSubmit={opts.onPublishSubmit}
                    />
                );
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

describe("PublishReportModal unresolved-items notice", () => {
    it("names the unresolved count on the screen that publishes", () => {
        renderModal(2);
        expect(screen.getByText(/2\s+item/i)).toBeTruthy();
    });

    it("leaves the publish button usable — a warning, not a gate", () => {
        renderModal(2);
        const publish = screen.getByRole("button", { name: /publish/i });
        expect((publish as HTMLButtonElement).disabled).toBe(false);
    });

    // POSITIVE CONTROL for the first assertion: with nothing unresolved the
    // notice must be absent. Without this, a modal that rendered the notice
    // unconditionally — or one whose count never reached it — would pass.
    it("says nothing when there is nothing unresolved", () => {
        renderModal(0);
        expect(screen.queryByText(/item\(s\)|items? still need attention/i)).toBeNull();
    });
});

/**
 * F79 — the modal offers no "who gets notified" switches, because nothing honours
 * them.
 *
 * It used to render `notifyClient` and `notifyAgent`. `publishInspection` declares
 * both in its options type and reads neither: who receives the report is decided
 * by the workspace's `report.published` automation rules. So the switches changed
 * nothing, and the publish audit entry recorded the flag as given — a publish
 * marked "notify nobody" was written down as one that notified nobody while every
 * rule fired and the mail went out.
 *
 * Removing them without answering the question they asked would be a second
 * defect, so the dialog now STATES who will be told and points at the surface
 * that decides it. That sentence is asserted here alongside the absence: a modal
 * that dropped the switches and said nothing would otherwise pass.
 *
 * The auto-sign toggle is the positive control. It proves the harness renders
 * toggle rows at all, so "no notify checkbox" means absent rather than
 * unrendered. (The signature/payment gate toggles used to be that control;
 * #506 removed them — they posted values the publish endpoint accepts but
 * never uses, the same F79 shape, and the gates live in GateToggle instead.)
 */
describe("PublishReportModal — no notify switches (F79)", () => {
    it("renders no notify-client / notify-agent control", async () => {
        renderModal(0);
        // The wire names, which is what the action used to read off the form.
        expect(await screen.findByRole("button", { name: /publish/i })).toBeTruthy();
        expect(document.querySelector('input[name="notifyClient"]')).toBeNull();
        expect(document.querySelector('input[name="notifyAgent"]')).toBeNull();
        // And the user-visible promise, whatever it happened to be labelled.
        expect(screen.queryByRole("checkbox", { name: /notify/i })).toBeNull();
    });

    it("states who will be notified, and points at what decides it", async () => {
        renderModal(0);
        expect(await screen.findByTestId("publish-notify-automation")).toBeTruthy();
        const link = await screen.findByRole("link", { name: /automation/i });
        expect(link.getAttribute("href")).toBe("/settings/automations");
    });

    // POSITIVE CONTROL: the auto-sign toggle is still a switch on this form,
    // so the absence assertions above are about the notify flags and not
    // about a modal that renders no checkboxes at all.
    it("still offers the auto-sign toggle", async () => {
        renderModal(0);
        expect(await screen.findByRole("checkbox", { name: /auto-sign/i })).toBeTruthy();
    });

    // #506 — the signature/payment gate toggles are gone: they posted
    // requireSignature/requirePayment, which the publish endpoint accepts but
    // never uses, so ticking them changed nothing about what the client must
    // do before viewing. The gates are set by GateToggle on the hub card.
    it("offers no signature/payment gate control", async () => {
        renderModal(0);
        expect(await screen.findByRole("button", { name: /publish/i })).toBeTruthy();
        expect(document.querySelector('input[name="requireSignature"]')).toBeNull();
        expect(document.querySelector('input[name="requirePayment"]')).toBeNull();
        expect(screen.queryByRole("checkbox", { name: /signature/i })).toBeNull();
        expect(screen.queryByRole("checkbox", { name: /payment/i })).toBeNull();
    });
});

/**
 * #484 — republishing a correction from the hub never notified the client:
 * the hub modal had no notify option and the hub action never sent
 * `notifyClient`, so an amendment always rode the server default (false) and
 * no `report.amended` rule fired.
 *
 * The choice is back for revisions only, mirroring the editor's PublishModal:
 * the server honours `notifyClient` on an amendment and ignores it on a first
 * publish or a republish after a retract, so the box renders only when
 * `noticeChoice` is true — the report was reopened with "Edit and republish".
 * Unchecked by default; the modal unmounts on close (Modal returns null),
 * so the box resets on every open.
 *
 * The submit assertions pin the form contract the hub action reads: a ticked
 * box posts `notifyClient=on`, an unticked one posts nothing. The human gate
 * passes through here (its context default is `async () => true`) and re-fires
 * the submit via `requestSubmit`, so the capture waits for the second event.
 */
describe("PublishReportModal — republish notice choice (#484)", () => {
    async function submitForm() {
        const form = document.getElementById("ih-publish-report-form") as HTMLFormElement;
        fireEvent.submit(form);
    }

    it("offers the notify box on a revision the server will honour", async () => {
        renderModalWithFetcher({ isAmendment: true, noticeChoice: true }, () => {});
        const box = await screen.findByRole("checkbox", { name: /report-updated notices/i });
        expect((box as HTMLInputElement).checked).toBe(false);
        expect(document.querySelector('input[name="notifyClient"]')).toBeTruthy();
        // The amendment sentence replaces the first-publish automation line:
        // the rules no longer decide alone, the box below does.
        expect(screen.getByText(/tick the box below/i)).toBeTruthy();
        expect(screen.queryByTestId("publish-notify-automation")).toBeNull();
    });

    it("posts notifyClient=on when the box is ticked", async () => {
        const onSubmitted = vi.fn();
        renderModalWithFetcher({ isAmendment: true, noticeChoice: true }, (data) => {
            onSubmitted(Object.fromEntries(data.entries()));
        });
        const box = await screen.findByRole("checkbox", { name: /report-updated notices/i });
        fireEvent.click(box);
        await submitForm();
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
        expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ notifyClient: "on" }));
    });

    it("posts no notifyClient when the box is left unticked", async () => {
        const onSubmitted = vi.fn();
        renderModalWithFetcher({ isAmendment: true, noticeChoice: true }, (data) => {
            onSubmitted(Object.fromEntries(data.entries()));
        });
        await screen.findByRole("checkbox", { name: /report-updated notices/i });
        await submitForm();
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
        const posted = onSubmitted.mock.calls[0][0] as Record<string, string>;
        expect(posted).not.toHaveProperty("notifyClient");
    });

    // POSITIVE CONTROL for the F79 case: an amendment the server will NOT
    // honour (republish after a retract — versions exist, but the report was
    // not reopened for editing) offers no box and keeps the automation line.
    // Without this, a modal that rendered the box on `isAmendment` alone —
    // the F79 lie in a new shape — would pass.
    it("offers no box when the revision is not a reopened-for-editing one", async () => {
        renderModalWithFetcher({ isAmendment: true, noticeChoice: false }, () => {});
        await screen.findByRole("button", { name: /publish/i });
        expect(document.querySelector('input[name="notifyClient"]')).toBeNull();
        expect(screen.queryByRole("checkbox", { name: /notify/i })).toBeNull();
        expect(screen.getByTestId("publish-notify-automation")).toBeTruthy();
    });

    // Item 3 — the banner cannot recover the choice after the publish (the
    // loader revalidates and the report is no longer "editing again"), so the
    // modal snapshots it at submit time via onPublishSubmit.
    it("reports the ticked choice at submit time", async () => {
        const onPublishSubmit = vi.fn();
        renderModalWithFetcher({ isAmendment: true, noticeChoice: true, onPublishSubmit }, () => {});
        const box = await screen.findByRole("checkbox", { name: /report-updated notices/i });
        fireEvent.click(box);
        await submitForm();
        await waitFor(() => expect(onPublishSubmit).toHaveBeenCalled());
        expect(onPublishSubmit).toHaveBeenCalledWith({ offered: true, notified: true });
    });

    it("reports the unticked choice at submit time", async () => {
        const onPublishSubmit = vi.fn();
        renderModalWithFetcher({ isAmendment: true, noticeChoice: true, onPublishSubmit }, () => {});
        await screen.findByRole("checkbox", { name: /report-updated notices/i });
        await submitForm();
        await waitFor(() => expect(onPublishSubmit).toHaveBeenCalled());
        expect(onPublishSubmit).toHaveBeenCalledWith({ offered: true, notified: false });
    });

    it("reports no choice when none was offered", async () => {
        const onPublishSubmit = vi.fn();
        renderModalWithFetcher({ isAmendment: true, noticeChoice: false, onPublishSubmit }, () => {});
        await screen.findByRole("button", { name: /publish/i });
        await submitForm();
        await waitFor(() => expect(onPublishSubmit).toHaveBeenCalled());
        expect(onPublishSubmit).toHaveBeenCalledWith({ offered: false, notified: false });
    });
});

/**
 * Review item 2 — both publish modals use the shared-ui primitives instead
 * of hand-written controls: Checkbox for the toggles, Textarea for the
 * amendment summary, Button for the footer. These assertions pin the
 * contract the primitives must keep: the footer publish button stays a
 * submit button bound to the form, and the summary box keeps its label.
 */
describe("PublishReportModal — shared-ui primitives (review item 2)", () => {
    it("the footer publish button submits the form", async () => {
        renderModal(0, { isAmendment: true });
        const publish = await screen.findByRole("button", { name: /publish/i });
        expect(publish.getAttribute("type")).toBe("submit");
        expect(publish.getAttribute("form")).toBe("ih-publish-report-form");
    });

    it("the summary box is labelled by the amendment question", async () => {
        renderModal(0, { isAmendment: true });
        const box = await screen.findByLabelText(/What changed in this amendment\?/i);
        expect(box.tagName).toBe("TEXTAREA");
    });

    it("the auto-sign toggle renders as a labelled checkbox", async () => {
        renderModal(0);
        expect(await screen.findByRole("checkbox", { name: /auto-sign/i })).toBeTruthy();
    });
});

/**
 * #506 — one set of publish options: the hub modal gains the editor's
 * mark-complete + auto-sign powers, and loses the gate checkboxes the server
 * never honoured.
 *
 * The mark-complete choice rides React state the footer button sets in its
 * onClick — not the submitter's name/value, which the human gate's bare
 * requestSubmit() re-fire would drop. The auto-sign box is an ordinary
 * checkbox: ticked posts `autoSignOnPublish=on`, unticked posts nothing, and
 * the action writes the box's state either way.
 */
describe("PublishReportModal — one set of publish options (#506)", () => {
    it("offers the auto-sign choice, unchecked by default", async () => {
        renderModal(0);
        const box = await screen.findByRole("checkbox", { name: /auto-sign/i });
        expect((box as HTMLInputElement).checked).toBe(false);
        expect(document.querySelector('input[name="autoSignOnPublish"]')).toBeTruthy();
    });

    it("defaults the auto-sign box from the stored flag", async () => {
        renderModal(0, { autoSign: true });
        const box = await screen.findByRole("checkbox", { name: /auto-sign/i });
        expect((box as HTMLInputElement).checked).toBe(true);
    });

    it("offers no mark-complete button once the work is complete", async () => {
        renderModal(0, { orderCompleted: true });
        expect(await screen.findByRole("button", { name: /^publish report$/i })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
    });

    it("offers mark-complete beside publish while the work is open", async () => {
        renderModal(0, { orderCompleted: false });
        expect(await screen.findByRole("button", { name: /^publish report$/i })).toBeTruthy();
        expect(await screen.findByRole("button", { name: /mark complete and publish/i })).toBeTruthy();
    });

    it("posts markComplete=true from the mark-complete button", async () => {
        const onSubmitted = vi.fn();
        renderModalWithFetcher({ orderCompleted: false }, (data) => {
            onSubmitted(Object.fromEntries(data.entries()));
        });
        const button = await screen.findByRole("button", { name: /mark complete and publish/i });
        fireEvent.click(button);
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
        expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ markComplete: "true" }));
    });

    it("posts markComplete=false from the just-publish button", async () => {
        const onSubmitted = vi.fn();
        renderModalWithFetcher({ orderCompleted: false }, (data) => {
            onSubmitted(Object.fromEntries(data.entries()));
        });
        const button = await screen.findByRole("button", { name: /^publish report$/i });
        fireEvent.click(button);
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
        expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ markComplete: "false" }));
    });

    it("posts autoSignOnPublish=on when the box is ticked", async () => {
        const onSubmitted = vi.fn();
        renderModalWithFetcher({}, (data) => {
            onSubmitted(Object.fromEntries(data.entries()));
        });
        const box = await screen.findByRole("checkbox", { name: /auto-sign/i });
        fireEvent.click(box);
        fireEvent.submit(document.getElementById("ih-publish-report-form") as HTMLFormElement);
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
        expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ autoSignOnPublish: "on" }));
    });

    it("posts no autoSignOnPublish when the box is left unticked", async () => {
        const onSubmitted = vi.fn();
        renderModalWithFetcher({}, (data) => {
            onSubmitted(Object.fromEntries(data.entries()));
        });
        await screen.findByRole("checkbox", { name: /auto-sign/i });
        fireEvent.submit(document.getElementById("ih-publish-report-form") as HTMLFormElement);
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
        const posted = onSubmitted.mock.calls[0][0] as Record<string, string>;
        expect(posted).not.toHaveProperty("autoSignOnPublish");
    });
});
