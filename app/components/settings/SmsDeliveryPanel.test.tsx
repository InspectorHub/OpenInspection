// @vitest-environment happy-dom
/**
 * Integrations -> SMS, the panel under the source choice: company phone, the
 * registration status of the company's own number, and the account details.
 *
 * What it replaces: the old "effective source" line (and its two defects, F58 a
 * managed-tier message pointing at the wrong party and F59 an unconfigured state
 * drawn in success green) is now the connection card above; that card's status
 * colour is covered with the page tests. What this panel still owns is asserted
 * here, including that a bad registration state is never drawn as a good one.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, within } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";

import { SmsDeliveryPanel } from "./SmsDeliveryPanel";
import type { ManagedComplianceData } from "./ManagedComplianceWizard";

afterEach(cleanup);

const COMPLIANCE: ManagedComplianceData = {
    complianceStatus: "not_started",
    rejectionReason: null,
    customerProfileStatus: null,
    brandStatus: null,
    campaignStatus: null,
    tfvStatus: null,
    messagingServiceSid: null,
    provisionedNumber: null,
};

const SECRETS = {
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_FROM_NUMBER: "",
    TELNYX_API_KEY: "",
    TELNYX_FROM_NUMBER: "",
    TELNYX_PUBLIC_KEY: "",
};

type Over = Partial<Parameters<typeof SmsDeliveryPanel>[0]>;

function Host(over: Over) {
    // A real fetcher: the panel hands it to its secrets sub-panel, and a
    // hand-built stub object would be a second thing that can be wrong.
    const smsTestFetcher = useFetcher();
    return (
        <SmsDeliveryPanel
            effectiveSource="own"
            companyPhone=""
            savingSmsConfig={false}
            byoProvider="twilio"
            compliance={COMPLIANCE}
            showAccountDetails
            accountComplete={false}
            secrets={SECRETS}
            secretFieldError={() => undefined}
            secretFormError={() => null}
            savingSmsSecrets={false}
            showInboundUrl={false}
            inboundUrl=""
            smsTestFetcher={smsTestFetcher as never}
            {...over}
        />
    );
}

function renderPanel(over: Over = {}, action?: () => unknown) {
    const Stub = createRoutesStub([{ path: "/", Component: () => <Host {...over} />, ...(action ? { action } : {}) }]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("registration status of the company's own number", () => {
    it("shows it for a Twilio number the company sends on", async () => {
        renderPanel({ compliance: { ...COMPLIANCE, complianceStatus: "approved" } });
        const block = await screen.findByTestId("sms-verification");
        expect(block.textContent).toContain("Approved");
    });

    it("does not show it for Telnyx, or when the company is not sending on its own number", async () => {
        renderPanel({ byoProvider: "telnyx" });
        await screen.findByLabelText(/Company phone/i);
        expect(screen.queryByTestId("sms-verification")).toBeNull();
        cleanup();
        renderPanel({ effectiveSource: "none" });
        await screen.findByLabelText(/Company phone/i);
        expect(screen.queryByTestId("sms-verification")).toBeNull();
    });

    it("draws approved in success, rejected in error with the reason, and in-between in neutral, never a raw colour", async () => {
        const classOf = async (status: ManagedComplianceData["complianceStatus"]) => {
            cleanup();
            renderPanel({ compliance: { ...COMPLIANCE, complianceStatus: status, rejectionReason: status === "rejected" ? "Website does not match." : null } });
            const block = await screen.findByTestId("sms-verification");
            return { cls: block.querySelector("span")!.className, text: block.textContent ?? "" };
        };
        const approved = await classOf("approved");
        const rejected = await classOf("rejected");
        const pending = await classOf("brand_pending");
        expect(approved.cls).toContain("text-ih-ok-fg");
        expect(rejected.cls).toContain("text-ih-bad-fg");
        expect(rejected.cls).not.toContain("text-ih-ok-fg");
        expect(rejected.text).toContain("Website does not match.");
        expect(pending.cls).not.toMatch(/text-ih-(ok|bad)-fg/);
        for (const { cls } of [approved, rejected, pending]) expect(cls).not.toMatch(/text-(\[#|emerald|green|red|amber|yellow|slate)/);
    });
});

describe("company phone", () => {
    it("is prefilled and posts only the intent and the phone, once, when Save is clicked twice in one frame", async () => {
        let calls = 0;
        let release: () => void = () => {};
        renderPanel({ companyPhone: "+15551112222" }, async () => {
            calls += 1;
            await new Promise<void>((resolve) => { release = resolve; });
            return null;
        });
        const phone = (await screen.findByLabelText(/Company phone/i)) as HTMLInputElement;
        expect(phone.value).toBe("+15551112222");
        const form = phone.closest("form")!;
        expect(Object.fromEntries(new FormData(form).entries())).toEqual({ intent: "save-sms-config", companyPhone: "+15551112222" });
        const save = within(form).getByRole("button", { name: "Save SMS settings" });
        act(() => { save.click(); save.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });
});

describe("account details", () => {
    it("are open while incomplete and folded once complete", async () => {
        renderPanel({ accountComplete: false });
        expect(((await screen.findByTestId("account-details")) as HTMLDetailsElement).open).toBe(true);
        cleanup();
        renderPanel({ accountComplete: true });
        expect(((await screen.findByTestId("account-details")) as HTMLDetailsElement).open).toBe(false);
    });

    it("stay out of sight while Built-in is selected, and the panel says they are kept", async () => {
        renderPanel({ showAccountDetails: false });
        await screen.findByLabelText(/Company phone/i);
        expect(screen.queryByTestId("account-details")).toBeNull();
        expect(screen.getByText(/Your own account details stay saved/)).toBeTruthy();
    });
});
