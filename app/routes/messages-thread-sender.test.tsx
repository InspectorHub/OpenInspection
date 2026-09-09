// @vitest-environment happy-dom
/**
 * The inbox says who spoke last.
 *
 * `lastFromRole` is computed in `message.service.ts`, declared on the API schema
 * with the description "Who wrote the newest message", and declared again on the
 * route's own `ThreadSummary` — and no row rendered it. The list showed the
 * contact's name, the time and the preview, so a thread whose last line was
 * yours looked exactly like one waiting on your reply.
 *
 * WHY A PREFIX ON THE PREVIEW RATHER THAN A BADGE. Surveyed 2026-09-08:
 * Spectora's Conversations documentation says the subtext of a message "will
 * always show when the message was sent, and who sent it" — sender identity
 * belongs beside the preview, not as a separate ornament. It is also the
 * universal inbox convention, and the row already carries the counterparty's
 * name, so only the OTHER case needs saying.
 *
 * `inspector` is us: the schema's own comment reads "Staff author when fromRole
 * === 'inspector'; null when the counterparty sent it". Everything else —
 * `client`, `agent`, `other` — is them, and the row's own heading already names
 * them.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ThreadPreview } from "~/routes/messages";

describe("thread list preview", () => {
    it("marks a thread whose last message was ours", () => {
        render(<ThreadPreview body="On my way" fromRole="inspector" />);
        expect(screen.getByText(/you:/i)).toBeTruthy();
    });

    // POSITIVE CONTROL: a prefix rendered unconditionally would pass the case
    // above. A message from the contact must carry none — the row is already
    // headed with their name.
    it("leaves a thread whose last message was theirs unmarked", () => {
        render(<ThreadPreview body="See you then" fromRole="client" />);
        expect(screen.queryByText(/you:/i)).toBeNull();
    });

    // `agent` and `other` are counterparties too, and the enum has four members.
    // Testing only `client` would pass an implementation that special-cased it.
    it("treats an agent's message as theirs", () => {
        render(<ThreadPreview body="Any update?" fromRole="agent" />);
        expect(screen.queryByText(/you:/i)).toBeNull();
    });

    it("still shows the message itself either way", () => {
        render(<ThreadPreview body="On my way" fromRole="inspector" />);
        expect(screen.getByText(/on my way/i)).toBeTruthy();
    });
});
