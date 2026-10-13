// @vitest-environment happy-dom
/**
 * Resending an invitation sends an email. Two clicks in one frame must reach the action once; a
 * later click after the action settles must go through.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, waitFor, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import TeamPage from "~/routes/team";

afterEach(cleanup);

const invite = {
    id: "id-1",
    name: null,
    email: "invitee@seed.test",
    role: "inspector",
    status: "pending",
    lastActiveAt: null,
    token: "11111111-aaaa-4aaa-8aaa-111111111111",
    inviteLink: "https://inspections.example.test/join?token=11111111-aaaa-4aaa-8aaa-111111111111",
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
};

describe("/team resend invitation", () => {
    it("resends once for a double click", async () => {
        let posts = 0;
        let release: () => void = () => {};
        const Stub = createRoutesStub([
            {
                path: "/team",
                Component: TeamPage,
                loader: () => ({ members: [invite], canManage: true, loadFailed: false }),
                action: async () => {
                    posts += 1;
                    await new Promise<void>((resolve) => { release = resolve; });
                    return { ok: false };
                },
            },
        ]);
        const { container } = render(<Stub initialEntries={["/team"]} />);
        fireEvent.click(await screen.findByRole("button", { name: /Pending Invites/i }));
        const button = await waitFor(() => {
            const input = container.querySelector<HTMLInputElement>('input[value="resend-invite"]');
            expect(input).not.toBeNull();
            return input!.form!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        });
        act(() => { button.click(); button.click(); });
        await waitFor(() => expect(posts).toBe(1));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(posts).toBe(1);
        await act(async () => { release(); });
        await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
        act(() => { button.click(); });
        await waitFor(() => expect(posts).toBe(2));
        await act(async () => { release(); });
    });
});
