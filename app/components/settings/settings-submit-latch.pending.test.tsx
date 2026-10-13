// @vitest-environment happy-dom
/**
 * Two clicks (or two submits) dispatched in ONE frame must reach the action once: the route
 * navigation is still "idle" when the second one lands, so `pendingProps` alone cannot stop it.
 * Found in a real browser: a double click on "Save Stripe keys" posted `save-stripe-secrets` twice.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { createRoutesStub, useFetcher, useRevalidator } from "react-router";
import { IntegrationKeysPanel } from "./advanced/IntegrationKeysPanel";
import { IsnPanel } from "./advanced/IsnPanel";
import { TurnstilePanel } from "./security/TurnstilePanel";
import { AiFeaturesPanel } from "./advanced/AiFeaturesPanel";
import { VideoIntegrationPanel } from "./integrations/VideoIntegrationPanel";
import { StripePaymentsPanel } from "./integrations/StripePaymentsPanel";
import { SmsSecretsPanel } from "./SmsSecretsPanel";
import { TestConnectionButton } from "./TestConnectionButton";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

const noError = () => undefined;

function renderRoute(Component: () => React.ReactElement) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component,
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return null;
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

function StripeHarness() {
    const revalidator = useRevalidator();
    return (
        <StripePaymentsPanel
            secrets={{ STRIPE_PUBLISHABLE_KEY: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" }}
            webhookUrl="https://x.test/hook" webhookLog={[]} saving={false}
            serverField={null} serverError={null} revalidator={revalidator}
        />
    );
}

function SmsHarness() {
    const fetcher = useFetcher<never>();
    return (
        <SmsSecretsPanel
            secrets={{ TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_FROM_NUMBER: "", TELNYX_API_KEY: "", TELNYX_FROM_NUMBER: "", TELNYX_PUBLIC_KEY: "" }}
            secretFieldError={noError} secretFormError={() => null} savingSmsSecrets={false} showInboundUrl={false}
            inboundUrl="" smsTestFetcher={fetcher as never}
        />
    );
}

function AiHarness() {
    const fetcher = useFetcher<never>();
    return (
        <AiFeaturesPanel
            geminiConfigured={false} aiEnabled courtesyTranslationEnabled={false} aiBaseUrl="" aiModel="" value=""
            fieldError={noError} saving={false} geminiTestFetcher={fetcher as never}
        />
    );
}

function ProbeHarness() {
    const fetcher = useFetcher();
    return <TestConnectionButton fetcher={fetcher} intent="test-x" />;
}

function attestAi() {
    for (const name of ["attestReviewedProviderTerms", "attestTierPermitsIntendedUse", "attestUnderstandsProviderProcessing"]) {
        fireEvent.click(document.querySelector(`input[name="${name}"]`)!);
    }
}

function typeInto(id: string, value: string) {
    const input = document.getElementById(id) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
}

const cases: Array<[string, () => React.ReactElement, RegExp, (() => void)?]> = [
    ["IntegrationKeysPanel", () => <IntegrationKeysPanel secrets={{ GOOGLE_PLACES_API_KEY: "", ESTATED_API_KEY: "", APP_BASE_URL: "" }} fieldError={noError} saving={false} />, /^save$/i],
    ["IsnPanel", () => <IsnPanel secrets={{ ISN_DOMAIN: "", ISN_COMPANY_KEY: "", ISN_ACCESS_KEY: "", ISN_SECRET_KEY: "" }} fieldError={noError} saving={false} />, /^save$/i],
    ["TurnstilePanel", () => <TurnstilePanel value="" fieldError={noError} saving={false} />, /^save$/i],
    ["AiFeaturesPanel save", AiHarness, /^save$/i, attestAi],
    ["VideoIntegrationPanel", () => <VideoIntegrationPanel videoMode="r2" streamCustomerSubdomain="" saving={false} serverError={null} serverField={null} />, /save/i],
    ["StripePaymentsPanel", StripeHarness, /save/i],
    ["SmsSecretsPanel save", SmsHarness, /^save/i],
    ["SmsSecretsPanel test SMS", SmsHarness, /send test/i],
    ["TestConnectionButton", ProbeHarness, /test connection|test/i],
];

describe.each(cases)("%s - same-frame submit latch", (_name, Component, label, prepare) => {
    it("lets only one of two same-frame clicks reach the action", async () => {
        renderRoute(Component);
        prepare?.();
        const button = screen.getAllByRole("button", { name: label })[0]!;
        act(() => { button.click(); button.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });

    it("CONTROL - a later submit after the action settles goes through", async () => {
        renderRoute(Component);
        prepare?.();
        const button = screen.getAllByRole("button", { name: label })[0]!;
        act(() => { button.click(); });
        await waitFor(() => expect(calls).toBe(1));
        await act(async () => { release(); });
        await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
        act(() => { button.click(); });
        await waitFor(() => expect(calls).toBe(2));
        await act(async () => { release(); });
    });
});

describe("two form submits in one act", () => {
    it("reach the action once", async () => {
        renderRoute(() => <TurnstilePanel value="" fieldError={noError} saving={false} />);
        const form = screen.getByRole("button", { name: /^save$/i }).closest("form")!;
        act(() => { fireEvent.submit(form); fireEvent.submit(form); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });
});

describe("StripePaymentsPanel client validation vs the latch", () => {
    it("an invalid first submit does not latch: invalid, then corrected, reaches the action once", async () => {
        renderRoute(StripeHarness);
        const button = screen.getByRole("button", { name: /save/i });
        typeInto("secret-STRIPE_PUBLISHABLE_KEY", "bogus");
        act(() => { button.click(); });
        expect(calls).toBe(0);
        expect(screen.getByText(/must start with pk_test_/i)).toBeTruthy();
        typeInto("secret-STRIPE_PUBLISHABLE_KEY", "pk_test_ok");
        act(() => { button.click(); button.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });
});

describe("VideoIntegrationPanel client validation vs the latch", () => {
    it("an invalid first submit does not latch: stream without a subdomain, then a valid one, reaches the action once", async () => {
        renderRoute(() => <VideoIntegrationPanel videoMode="stream" streamCustomerSubdomain="" saving={false} serverError={null} serverField={null} />);
        const button = screen.getByRole("button", { name: /save/i });
        act(() => { button.click(); });
        expect(calls).toBe(0);
        const input = document.getElementById("streamCustomerSubdomain") as HTMLInputElement;
        act(() => { fireEvent.change(input, { target: { value: "customer-abc" } }); });
        act(() => { button.click(); button.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });
});
