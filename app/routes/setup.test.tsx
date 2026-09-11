// @vitest-environment happy-dom
/**
 * F74 — first-run setup has to name the step that leaves the agent portal dead.
 *
 * Publishing agent terms is a manual, deployment-level step in BOTH modes: the
 * gate does not branch on `APP_MODE`, no workspace administrator can supply the
 * document, and until it exists `POST /api/agent-signup` refuses and agents are
 * told "Agent sign-up is not available yet" with no way forward. It is covered
 * thoroughly in `docs/operate/deploy.md`, and nowhere an operator who only runs
 * the wizard would ever see it.
 *
 * The claim under test is that the setup SURFACE names the step and its
 * consequence — and that it stays a note, not a gate: the terms are published
 * from the command line, so nothing here may block finishing setup.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(async () => null),
    createSessionWithToken: vi.fn(),
}));

vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({})),
}));

import SetupPage from "~/routes/setup";

function renderSetup() {
    const Stub = createRoutesStub([
        {
            path: "/setup",
            Component: SetupPage,
            loader: () => ({ ready: true }),
            action: async () => ({}),
        },
    ]);
    return render(<Stub initialEntries={["/setup"]} />);
}

describe("first-run setup — the agent-terms step", () => {
    it("names agent sign-up and what is off until the terms are published", async () => {
        const { container } = renderSetup();
        // Positive control: the surface this assertion is aimed at really did
        // render. A bad selector reports "absent" indistinguishably otherwise.
        expect(await screen.findByText(/Create Account/i)).toBeTruthy();

        expect(container.textContent).toMatch(/agent sign-up/i);
        expect(container.textContent).toMatch(/agent terms/i);
    });

    it("says only whoever operates the deployment can do it, and points at the command", async () => {
        const { container } = renderSetup();
        await screen.findByText(/Create Account/i);
        expect(container.textContent).toMatch(/operates this deployment/i);
        expect(container.textContent).toMatch(/agent-terms:publish/);
    });

    it("does not block finishing setup", async () => {
        renderSetup();
        const submit = await screen.findByRole("button", { name: /Create Account/i });
        expect(submit).not.toBeDisabled();
    });
});
