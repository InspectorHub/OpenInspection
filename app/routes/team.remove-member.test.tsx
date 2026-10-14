// @vitest-environment happy-dom
/**
 * `/team` — removing a member.
 *
 * Who may be offered the control: every active member row except the viewer's
 * own (the API refuses a self-removal with a 400, so offering it only walks the
 * viewer into a refusal), and nothing at all to someone who cannot manage the
 * team. Opening it must show the unsynced-data warning before anything is sent.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { Outlet, createRoutesStub } from "react-router";

import TeamPage from "~/routes/team";

const member = (id: string, email: string, role = "inspector") => ({
    id, name: null, email, role, status: "active", lastActiveAt: null,
    token: null, inviteLink: null, expiresAt: null, permissionOverrides: null, totpEnabled: false,
});

const ME = member("id-me", "Me@seed.test");
const OTHER = member("id-other", "other@seed.test");

function renderTeam(
    canManage: boolean,
    { isOwner = true, rows = [ME, OTHER], viewerEmail = "me@seed.test" as string | null } = {},
) {
    const Stub = createRoutesStub([
        {
            id: "routes/auth-layout",
            Component: Outlet,
            loader: () => ({ context: { user: viewerEmail ? { email: viewerEmail } : {}, branding: {}, seatUsage: null } }),
            children: [
                {
                    path: "/team",
                    Component: TeamPage,
                    loader: () => ({ members: rows, canManage, isOwner, loadFailed: false }),
                },
            ],
        },
    ]);
    return render(<Stub initialEntries={["/team"]} />);
}

const removeButtons = () => screen.queryAllByRole("button", { name: "Remove" });

afterEach(cleanup);

describe("/team — removing a member", () => {
    it("offers Remove on every row except the viewer's own", async () => {
        renderTeam(true);
        await screen.findByText(OTHER.email);
        expect(removeButtons()).toHaveLength(1);
    });

    it("offers nothing to someone who cannot manage the team", async () => {
        renderTeam(false);
        await screen.findByText(OTHER.email);
        expect(removeButtons()).toHaveLength(0);
    });

    describe("owner rows", () => {
        const OWNER_ROW = member("id-owner", "boss@seed.test", "owner");

        it("hides Remove on an owner row from a viewer who is not an owner", async () => {
            renderTeam(true, { isOwner: false, rows: [ME, OTHER, OWNER_ROW] });
            await screen.findByText(OWNER_ROW.email);
            // Only the inspector row: the API refuses a manager the removal of an owner.
            expect(removeButtons()).toHaveLength(1);
        });

        it("offers Remove on an owner row to an owner", async () => {
            renderTeam(true, { isOwner: true, rows: [ME, OTHER, OWNER_ROW] });
            await screen.findByText(OWNER_ROW.email);
            expect(removeButtons()).toHaveLength(2);
        });
    });

    it("offers no Remove at all when the viewer's identity is unknown", async () => {
        renderTeam(true, { viewerEmail: null });
        await screen.findByText(OTHER.email);
        expect(removeButtons()).toHaveLength(0);
    });

    it("opens a dialog naming the member with the unsynced-data warning", async () => {
        renderTeam(true);
        await screen.findByText(OTHER.email);
        fireEvent.click(removeButtons()[0]);
        const dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toContain(`Remove ${OTHER.email}?`);
        expect(within(dialog).getByRole("alert").textContent).toContain("Their devices may still hold inspection data that has not been uploaded.");
    });
});
