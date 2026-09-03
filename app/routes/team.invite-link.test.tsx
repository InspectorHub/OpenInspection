// @vitest-environment happy-dom
/**
 * `/team` — reaching an invitation link without the clipboard.
 *
 * The endpoint has returned `inviteLink` since it was written and no screen
 * ever showed it, so the only way to accept an invitation was the email. That
 * made the drawer's "send email notification" checkbox unusable in the one
 * direction it exists for: unticking it produced an invitation nobody could
 * reach.
 *
 * The first fix was a "Copy link" button, and it was the wrong shape. A
 * copy-only control puts the whole capability behind `navigator.clipboard`,
 * which is allowed to do nothing: it rejects on an insecure origin or a
 * browser policy, and in a BACKGROUND tab Chrome leaves the promise pending
 * forever instead of rejecting — a click answered by silence, observed rather
 * than theorised. It also does not do what was asked, which was to VIEW the
 * link and hand it over yourself; a string in the clipboard is not a string
 * you can read.
 *
 * So these tests are deliberately written with NO clipboard stub in place.
 * Every assertion below has to hold in an environment where copying is
 * impossible — because that environment is real, and because a test that
 * stubbed the clipboard would pass just as well against the copy-only version
 * this replaces.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import TeamPage from "~/routes/team";

const TOKEN_A = "11111111-aaaa-4aaa-8aaa-111111111111";
const TOKEN_B = "22222222-bbbb-4bbb-8bbb-222222222222";

// Deliberately NOT this page's own origin. The URL the screen shows has to be
// the one the server built — the same one it emailed — and a fixture served
// from localhost cannot tell those apart if it agrees with localhost.
const DEPLOY_ORIGIN = "https://inspections.example.test";
const linkFor = (token: string) => `${DEPLOY_ORIGIN}/join?token=${token}`;

const pending = (email: string, token: string) => ({
    id: `id-${token}`,
    name: null,
    email,
    role: "inspector",
    status: "pending",
    lastActiveAt: null,
    token,
    inviteLink: linkFor(token),
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
});

const active = {
    id: "id-active",
    name: "Already Here",
    email: "active@seed.test",
    role: "manager",
    status: "active",
    lastActiveAt: null,
    token: null,
    inviteLink: null,
    expiresAt: null,
};

function renderTeam(members: unknown[]) {
    const Stub = createRoutesStub([
        { path: "/team", Component: TeamPage, loader: () => ({ members, canManage: true, loadFailed: false }) },
    ]);
    return render(<Stub initialEntries={["/team"]} />);
}

/** Open the Pending Invites tab — the rows are not rendered on Active. */
async function openPending() {
    fireEvent.click(await screen.findByRole("button", { name: /Pending Invites/i }));
}

/** Open the dialog for the nth pending row (0-based). */
async function openLink(index = 0) {
    fireEvent.click(screen.getAllByRole("button", { name: /Invite link/i })[index]);
    return screen.findByRole("dialog");
}

describe("/team — an invitation link you can read", () => {
    it("CONTROL — a pending row offers the control, an active member does not", async () => {
        renderTeam([active, pending("invitee@seed.test", TOKEN_A)]);
        await openPending();

        // Exactly one, from the one row that has a token. Without this, "the
        // link is on screen" below is satisfied by a page that shows every
        // member's link, which would be a different and worse defect.
        expect(screen.getAllByRole("button", { name: /Invite link/i })).toHaveLength(1);
    });

    it("shows the accept URL as readable text — no clipboard involved", async () => {
        renderTeam([pending("invitee@seed.test", TOKEN_A)]);
        await openPending();
        const dialog = await openLink();
        const field = within(dialog).getByRole("textbox") as HTMLInputElement;
        expect(field.value).toBe(linkFor(TOKEN_A));
        // The page is served from localhost; the link is not. A page that
        // composed the URL from its own origin would fail exactly here, and
        // that composition is what this replaces.
        expect(field.value).not.toContain(window.location.origin);
        // Readable, not editable: this is a value to copy out, and a typo in it
        // would produce a link that looks right and joins nothing.
        expect(field.readOnly).toBe(true);
    });

    it("shows THAT row's token when several invitations are pending", async () => {
        renderTeam([pending("first@seed.test", TOKEN_A), pending("second@seed.test", TOKEN_B)]);
        await openPending();

        // The second row. A single-invite fixture cannot tell a correct
        // implementation from one that always shows the first token.
        const dialog = await openLink(1);
        const field = within(dialog).getByRole("textbox") as HTMLInputElement;
        expect(field.value).toContain(TOKEN_B);
        expect(field.value).not.toContain(TOKEN_A);
    });

    it("names the invitee and says the link is a credential", async () => {
        renderTeam([pending("invitee@seed.test", TOKEN_A)]);
        await openPending();
        const dialog = await openLink();
        // Whoever opens this URL takes the seat, so handing it to the wrong
        // person is not a mistake that can be undone by re-sending it.
        expect(within(dialog).getByText(/invitee@seed\.test/)).toBeTruthy();
        expect(within(dialog).getByText(/password/i)).toBeTruthy();
    });

    it("NEGATIVE CONTROL — pressing Copy cannot make the link disappear", async () => {
        renderTeam([pending("invitee@seed.test", TOKEN_A)]);
        await openPending();
        const dialog = await openLink();
        // No clipboard here, so this is the failing path — the one that used to
        // be the entire feature. The dialog must survive it unchanged.
        fireEvent.click(within(dialog).getByRole("button", { name: /Copy link/i }));

        const field = within(dialog).getByRole("textbox") as HTMLInputElement;
        expect(field.value).toContain(TOKEN_A);
    });
});
