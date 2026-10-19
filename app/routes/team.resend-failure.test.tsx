// @vitest-environment happy-dom
/**
 * A refused "Resend invitation" used to be silent. It now shows an alert, which
 * goes away when the next attempt starts and does not appear when it works.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import TeamPage from "~/routes/team";

const INVITE = { id: "id-1", name: null, email: "invitee@seed.test", role: "inspector", status: "pending", lastActiveAt: null, token: "11111111-aaaa-4aaa-8aaa-111111111111", inviteLink: "https://x.test/join?token=1", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };

function mount(answers: boolean[]) {
    const Stub = createRoutesStub([{
        path: "/team",
        Component: TeamPage,
        loader: () => ({ members: [INVITE], templates: [], canManage: true, loadFailed: false }),
        action: async () => ({ ok: answers.shift() ?? true, resent: true, intent: "resend-invite" }),
    }]);
    return render(<Stub initialEntries={["/team"]} />);
}

const resend = async () => {
    const button = await waitFor(() => {
        const input = document.querySelector<HTMLInputElement>('input[value="resend-invite"]');
        expect(input).not.toBeNull();
        return input!.form!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    });
    fireEvent.click(button);
};

describe("/team resend invitation failure", () => {
    it("shows an alert when the resend is refused, and clears it after a retry that works", async () => {
        mount([false, true]);
        fireEvent.click(await screen.findByRole("button", { name: /Pending Invites/i }));
        await resend();
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be sent again/i);
        await new Promise((r) => setTimeout(r, 50));
        await resend();
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });

    it("CONTROL: no alert when the resend works", async () => {
        mount([true]);
        fireEvent.click(await screen.findByRole("button", { name: /Pending Invites/i }));
        await resend();
        await new Promise((r) => setTimeout(r, 100));
        expect(screen.queryByRole("alert")).toBeNull();
    });
});
