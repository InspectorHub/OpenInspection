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

const member = (id: string, email: string) => ({
    id, name: null, email, role: "inspector", status: "active", lastActiveAt: null,
    token: null, inviteLink: null, expiresAt: null, permissionOverrides: null, totpEnabled: false,
});

const ME = member("id-me", "Me@seed.test");
const OTHER = member("id-other", "other@seed.test");

function renderTeam(canManage: boolean) {
    const Stub = createRoutesStub([
        {
            id: "routes/auth-layout",
            Component: Outlet,
            loader: () => ({ context: { user: { email: "me@seed.test" }, branding: {}, seatUsage: null } }),
            children: [
                {
                    path: "/team",
                    Component: TeamPage,
                    loader: () => ({ members: [ME, OTHER], canManage, isOwner: true, loadFailed: false }),
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

    it("opens a dialog naming the member with the unsynced-data warning", async () => {
        renderTeam(true);
        await screen.findByText(OTHER.email);
        fireEvent.click(removeButtons()[0]);
        const dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toContain(`Remove ${OTHER.email}?`);
        expect(within(dialog).getByRole("alert").textContent).toContain("Their devices may still hold inspection data that has not been uploaded.");
    });
});
