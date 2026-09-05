// @vitest-environment happy-dom
/**
 * `/team` — the owner's two-factor reset.
 *
 * WHY THE CONTROL EXISTS. Every self-service 2FA endpoint requires a valid
 * code: `/2fa/disable` and `/2fa/recovery-codes/regenerate` both ask for the
 * current password AND a TOTP or recovery code. Somebody who has lost the
 * authenticator and the recovery codes therefore had no way back into the
 * workspace, and — grepped across `server/api/` — nobody else had one either.
 *
 * WHY THESE ASSERTIONS. The control is the only action in the product that
 * lowers ANOTHER person's authentication requirement, so the two things worth
 * pinning are who may see it and where it may appear: an owner, on a member
 * who actually has an enrolment. Both halves are load-bearing. Offering it to
 * a manager walks them into a 403 the API will raise anyway; offering it on a
 * member with no enrolment answers with a refusal that could have been spared.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import TeamPage from "~/routes/team";

const member = (
    id: string,
    email: string,
    totpEnabled: boolean,
    role = "inspector",
) => ({
    id,
    name: null,
    email,
    role,
    status: "active",
    lastActiveAt: null,
    token: null,
    inviteLink: null,
    expiresAt: null,
    permissionOverrides: null,
    totpEnabled,
});

const ENROLLED = member("id-enrolled", "locked-out@seed.test", true);
const PLAIN = member("id-plain", "plain@seed.test", false);

function renderTeam(members: unknown[], isOwner: boolean) {
    const Stub = createRoutesStub([
        {
            path: "/team",
            Component: TeamPage,
            loader: () => ({ members, canManage: true, isOwner, loadFailed: false }),
        },
    ]);
    return render(<Stub initialEntries={["/team"]} />);
}

const resetButtons = () => screen.queryAllByRole("button", { name: /Reset 2FA/i });

describe("/team — clearing a member's second factor", () => {
    it("offers it on an enrolled member and on no other row", async () => {
        renderTeam([ENROLLED, PLAIN], true);
        await screen.findByText(ENROLLED.email);

        // Exactly one. Without the count, "the control is on screen" is also
        // satisfied by a page offering it on every member — a different and
        // worse defect, since pressing it on `PLAIN` can only be refused.
        expect(resetButtons()).toHaveLength(1);
    });

    it("does not offer it to a manager, who cannot perform it", async () => {
        // The API guards with requireRole('owner'). A manager shown the button
        // gets a confirmation dialog, presses through it, and is refused —
        // having been told by the interface that they could.
        renderTeam([ENROLLED, PLAIN], false);
        await screen.findByText(ENROLLED.email);
        expect(resetButtons()).toHaveLength(0);
    });

    it("asks first, in a dialog that says what the reset does and does not do", async () => {
        renderTeam([ENROLLED], true);
        await screen.findByText(ENROLLED.email);

        fireEvent.click(resetButtons()[0]);
        const dialog = await screen.findByRole("dialog");

        // Named, so an owner with two locked-out people cannot clear the wrong
        // one from a dialog that says only "this member".
        expect(dialog.textContent).toContain(ENROLLED.email);
        // The two limits, because an owner reaching for this is usually
        // responding to something and needs to know it is not a remedy for a
        // compromised account.
        expect(dialog.textContent).toMatch(/does not change their password/i);
        expect(dialog.textContent).toMatch(/does not sign them out/i);
    });

    it("does nothing until the dialog is confirmed", async () => {
        renderTeam([ENROLLED], true);
        await screen.findByText(ENROLLED.email);

        fireEvent.click(resetButtons()[0]);
        const dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

        expect(screen.queryByRole("dialog")).toBeNull();
        // The row is still offering the reset, which is the observable proof
        // that cancelling did not perform it.
        expect(resetButtons()).toHaveLength(1);
    });
});
