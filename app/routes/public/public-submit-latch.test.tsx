// @vitest-environment happy-dom
/**
 * Anonymous visitors double-click too. Two submits dispatched in one frame must
 * reach the route action once, and a later submit after the action settles must
 * go through.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ComponentType } from "react";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import SmsOptinPage from "./sms-optin";
import UnsubscribePage from "./unsubscribe";
import ConciergeConfirmTokenPage from "./concierge-confirm-token";
import PortalLanding from "./portal";
import PortalNotificationsPage from "./portal-notifications";
import { EMPTY_BRAND } from "~/lib/brand";

afterEach(cleanup);

let posts = 0;
let release: () => void = () => {};
beforeEach(() => {
    posts = 0;
    release = () => {};
});

function mount(Component: ComponentType, path: string, entry: string, loaderData: unknown, actionResult: unknown) {
    const Stub = createRoutesStub([
        {
            path,
            Component,
            loader: () => loaderData,
            action: async () => {
                posts += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return actionResult;
            },
        },
    ]);
    return render(<Stub initialEntries={[entry]} />);
}

async function submitButton(container: HTMLElement): Promise<HTMLButtonElement> {
    return waitFor(() => {
        const button = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
        expect(button).not.toBeNull();
        return button!;
    });
}

async function expectOnceThenAgain(container: HTMLElement, fill?: (container: HTMLElement) => void) {
    const button = await submitButton(container);
    fill?.(container);
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(posts).toBe(1));
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(posts).toBe(1);
    await act(async () => { release(); });
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
    act(() => { button.click(); });
    await waitFor(() => expect(posts).toBe(2));
    await act(async () => { release(); });
}

function fillEmail(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>('input[name="email"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
        setter.call(input, "client@example.com");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

describe("sms-optin", () => {
    it("records the consent once for a double click", async () => {
        const { container } = mount(
            SmsOptinPage, "/sms-optin/:token", "/sms-optin/t1",
            { token: "t1", data: { companyName: "Acme", disclosureText: "Msg and data rates may apply.", privacyUrl: null, termsUrl: null } },
            { ok: false, error: "nope" },
        );
        await expectOnceThenAgain(container);
    });
});

describe("unsubscribe", () => {
    const data = { companyName: "Acme", label: "Reminders", classId: "c", muted: false };

    it("posts the unsubscribe once for a double click", async () => {
        const { container } = mount(UnsubscribePage, "/unsubscribe/:token", "/unsubscribe/t1", { data }, { ok: false, enabled: false, error: "x" });
        await expectOnceThenAgain(container);
    });

    it("posts the resubscribe once for a double click", async () => {
        const { container } = mount(UnsubscribePage, "/unsubscribe/:token", "/unsubscribe/t1", { data: { ...data, muted: true } }, { ok: false, enabled: true, error: "x" });
        await expectOnceThenAgain(container);
    });
});

describe("concierge-confirm-token", () => {
    it("redeems the token once for a double click", async () => {
        const view = {
            inspection: { propertyAddress: "1 Main St", date: "2026-06-18T10:00:00Z", clientName: "Dana", agreementRequired: false },
            inspector: null, expired: false, alreadyConfirmed: false,
        };
        const { container } = mount(
            ConciergeConfirmTokenPage, "/concierge/confirm/:token", "/concierge/confirm/t1",
            { view, status: "ok", date: view.inspection.date },
            { ok: false },
        );
        await expectOnceThenAgain(container);
    });
});

describe("portal landing", () => {
    it("requests the sign-in link once for a double click", async () => {
        const { container } = mount(
            PortalLanding, "/portal/:tenant", "/portal/acme",
            { authed: false, tenant: "acme", brand: EMPTY_BRAND },
            { sent: false },
        );
        await expectOnceThenAgain(container, fillEmail);
    });
});

describe("portal notifications", () => {
    it("requests the sign-in link once for a double click", async () => {
        const { container } = mount(
            PortalNotificationsPage, "/portal/:tenant/notifications", "/portal/acme/notifications",
            { authed: false, tenant: "acme", brand: EMPTY_BRAND },
            { sent: false },
        );
        await expectOnceThenAgain(container, fillEmail);
    });
});
