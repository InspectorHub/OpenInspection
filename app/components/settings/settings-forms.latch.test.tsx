// @vitest-environment happy-dom
/**
 * Two submits of a settings route form dispatched in ONE frame reach the route
 * action once: `navigation.state` only flips after React renders, so the
 * panel's pending button is not yet inert when the second submit lands.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";

import { EmailSecretsPanel } from "./EmailSecretsPanel";
import { GoogleCalendarPanel } from "./GoogleCalendarPanel";
import { QboCredentialsForm } from "./QboCredentialsForm";
import { SmsDeliveryPanel } from "./SmsDeliveryPanel";
import { ManagedComplianceWizard, type ManagedComplianceData } from "./ManagedComplianceWizard";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

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

const EMAIL_SECRETS = {
    RESEND_API_KEY: "",
    SENDGRID_API_KEY: "",
    POSTMARK_SERVER_TOKEN: "",
    MAILGUN_API_KEY: "",
    MAILGUN_DOMAIN: "",
    RESEND_WEBHOOK_SECRET: "",
    SENDGRID_WEBHOOK_PUBLIC_KEY: "",
    POSTMARK_WEBHOOK_TOKEN: "",
    MAILGUN_SIGNING_KEY: "",
};

const SMS_SECRETS = {
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_FROM_NUMBER: "",
    TELNYX_API_KEY: "",
    TELNYX_FROM_NUMBER: "",
    TELNYX_PUBLIC_KEY: "",
};

function EmailHost() {
    const emailValidateFetcher = useFetcher();
    return (
        <EmailSecretsPanel
            secrets={EMAIL_SECRETS}
            secretFieldError={() => undefined}
            secretFormError={() => null}
            savingEmailSecrets={false}
            emailValidateFetcher={emailValidateFetcher as never}
        />
    );
}

function SmsHost() {
    const smsTestFetcher = useFetcher();
    return (
        <SmsDeliveryPanel
            isSaas={false}
            smsMode="own"
            setSmsMode={() => {}}
            smsConfig={{ mode: "own", effectiveSource: "none" }}
            companyPhone=""
            savingSmsConfig={false}
            secrets={SMS_SECRETS}
            secretFieldError={() => undefined}
            secretFormError={() => null}
            savingSmsSecrets={false}
            showInboundUrl={false}
            inboundUrl=""
            smsTestFetcher={smsTestFetcher as never}
            compliance={COMPLIANCE}
        />
    );
}

const googlePanel = (
    <GoogleCalendarPanel
        isSaas
        googleOAuthConfigured={false}
        googleOAuthMode="own"
        secrets={{ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }}
        secretFieldError={() => undefined}
        secretFormError={() => null}
        savingCalendarSecrets={false}
        savingOAuthMode={false}
    />
);

const wizard = (
    <ManagedComplianceWizard compliance={COMPLIANCE} legalName="Acme LLC" managedProvider="twilio" />
);

const CASES: Array<{ name: string; intent: string; ui: () => ReactElement }> = [
    { name: "EmailSecretsPanel save", intent: "save-email-secrets", ui: () => <EmailHost /> },
    { name: "GoogleCalendarPanel OAuth mode", intent: "save-google-oauth-mode", ui: () => googlePanel },
    { name: "GoogleCalendarPanel credentials", intent: "save-calendar-secrets", ui: () => googlePanel },
    {
        name: "QboCredentialsForm save",
        intent: "save-qbo-secrets",
        ui: () => (
            <QboCredentialsForm
                secrets={{ QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "", QBO_ENV: "" }}
                envProvided={{ QBO_CLIENT_ID: false, QBO_CLIENT_SECRET: false, QBO_WEBHOOK_SECRET: false, QBO_ENV: false }}
                saving={false}
            />
        ),
    },
    { name: "SmsDeliveryPanel config", intent: "save-sms-config", ui: () => <SmsHost /> },
    { name: "ManagedComplianceWizard carrier", intent: "save-managed-provider", ui: () => wizard },
    { name: "ManagedComplianceWizard provision", intent: "sms-compliance-provision", ui: () => wizard },
];

function mount(ui: () => ReactElement) {
    const calls: string[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: ui,
            action: async ({ request }) => {
                calls.push(String((await request.formData()).get("intent")));
                return null;
            },
        },
    ]);
    const view = render(<Stub initialEntries={["/"]} />);
    return { calls, container: view.container };
}

function formFor(container: HTMLElement, intent: string): HTMLFormElement {
    const input = container.querySelector(`input[name="intent"][value="${intent}"]`);
    const form = input?.closest("form");
    if (!form) throw new Error(`no form for ${intent}`);
    return form;
}

describe("settings route forms - same-frame submit latch", () => {
    it.each(CASES)("$name reaches the action once for two same-frame submits", async ({ intent, ui }) => {
        const { calls, container } = mount(ui);
        const form = formFor(container, intent);
        act(() => { fireEvent.submit(form); fireEvent.submit(form); });
        await settle();
        expect(calls).toEqual([intent]);
    });

    it.each(CASES)("$name CONTROL - submits again once the first has settled", async ({ intent, ui }) => {
        const { calls, container } = mount(ui);
        const form = formFor(container, intent);
        act(() => { fireEvent.submit(form); });
        await settle();
        act(() => { fireEvent.submit(form); });
        await settle();
        expect(calls).toEqual([intent, intent]);
    });
});
