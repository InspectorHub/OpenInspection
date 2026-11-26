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
 * The count is all the hub has: its payload carries `{ ready, blockingCount }`
 * and not the defects themselves — those come from a separate endpoint the
 * editor calls. Listing them here would be a server change, not a copy change.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";
import type { FormHTMLAttributes } from "react";

import { PublishReportModal } from "~/components/inspector-portal/PublishReportModal";

afterEach(cleanup);

function renderModal(
    blockingCount: number,
    opts: { isAmendment?: boolean; noticeChoice?: boolean } = {},
) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component() {
                const fetcher = useFetcher();
                return (
                    <PublishReportModal
                        open
                        agreementRequired={false}
                        paymentRequired={false}
                        isAmendment={opts.isAmendment ?? false}
                        noticeChoice={opts.noticeChoice}
                        courtesyTranslationEnabled={false}
                        courtesyTranslationLocale="es-419"
                        clientPrefersTranslation={false}
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
 * The two remaining toggles are the positive control. They prove the harness
 * renders toggle rows at all, so "no notify checkbox" means absent rather than
 * unrendered.
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

    // POSITIVE CONTROL: the gate toggles are still switches on this form, so the
    // absence assertions above are about these two flags and not about a modal
    // that renders no checkboxes at all.
    it("still offers the two gates the server does honour", async () => {
        renderModal(0);
        expect(await screen.findByRole("checkbox", { name: /signature/i })).toBeTruthy();
        expect(await screen.findByRole("checkbox", { name: /payment/i })).toBeTruthy();
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
        opts: { isAmendment?: boolean; noticeChoice?: boolean },
        onSubmitted: (data: FormData) => void,
    ) {
        const Stub = createRoutesStub([
            {
                path: "/",
                Component() {
                    return (
                        <PublishReportModal
                            open
                            agreementRequired={false}
                            paymentRequired={false}
                            isAmendment={opts.isAmendment ?? false}
                            noticeChoice={opts.noticeChoice}
                            courtesyTranslationEnabled={false}
                            courtesyTranslationLocale="es-419"
                            clientPrefersTranslation={false}
                            blockingCount={0}
                            fetcher={makeCapturingFetcher(onSubmitted)}
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
});
