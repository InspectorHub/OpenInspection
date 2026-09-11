// @vitest-environment happy-dom
/**
 * Settings → Communication, the "effective source" line. Two defects, one line
 * of markup.
 *
 * F58 — the platform had no Twilio credentials, so the managed tier ("No setup
 * needed", selected by default) resolved to NO sender, and the page then told
 * the tenant to "set your provider credentials below". Three things wrong with
 * that sentence at once: the missing credentials are the deployment's, not the
 * tenant's; there is nothing the tenant can do about it; and in managed mode the
 * credentials panel it points at is not even rendered.
 *
 * F59 — all three states shared `text-ih-ok-fg`, so "SMS not configured" was
 * drawn in the same success green as "Using your Twilio". A blocking
 * configuration gap rendered as a healthy one.
 *
 * ⚠️ ON ASSERTING COLOUR HERE. happy-dom loads no stylesheet, so
 * `getComputedStyle(...).color` is empty for every element in this file and the
 * rendered pixel is not observable. What IS observable — and what actually
 * changed — is that the three states no longer resolve to one class: the
 * assertions below check the SEMANTIC token each state selects, in both
 * directions (ok absent AND watch present). Whether `--ih-status-watch-fg` is
 * worth enough contrast is a different question, asked by `lint:contrast`, which
 * reads the stylesheet this environment does not have.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";

import { SmsDeliveryPanel, type SmsModeValue } from "./SmsDeliveryPanel";
import type { ManagedComplianceData } from "./ManagedComplianceWizard";

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

type Source = "platform" | "own" | "managed" | "none";
type Mode = "platform" | "own" | "managed_shared" | "managed_dedicated";

function renderPanel(mode: Mode, effectiveSource: Source) {
    function Host() {
        // A real fetcher: the panel hands it to its secrets sub-panel, and a
        // hand-built stub object would be a second thing that can be wrong.
        const smsTestFetcher = useFetcher();
        return (
            <SmsDeliveryPanel
                isSaas
                smsMode={(mode === "platform" ? "own" : mode) as SmsModeValue}
                setSmsMode={() => {}}
                smsConfig={{ mode, effectiveSource }}
                companyPhone=""
                savingSmsConfig={false}
                secrets={SECRETS}
                secretFieldError={() => undefined}
                secretFormError={() => null}
                savingSmsSecrets={false}
                showInboundUrl={false}
                inboundUrl=""
                smsTestFetcher={smsTestFetcher}
                compliance={COMPLIANCE}
            />
        );
    }
    const Stub = createRoutesStub([{ path: "/", Component: Host }]);
    const view = render(<Stub initialEntries={["/"]} />);
    const line = view.container.querySelector<HTMLElement>('[data-testid="sms-effective-source"]');
    if (!line) throw new Error("no effective-source line rendered");
    return { ...view, line };
}

describe("SMS effective-source line — F58", () => {
    it("tells a managed-mode tenant the DEPLOYMENT is missing the number, not them", () => {
        const { line } = renderPanel("managed_shared", "none");
        const text = line.textContent ?? "";

        // The sentence that shipped, pointed at the wrong party.
        expect(text).not.toContain("set your provider credentials below");
        // What is actually true, and who can act on it.
        expect(text).toContain("unavailable on this deployment");
        expect(text).toContain("Your own credentials are not what is missing");
    });

    it("says the managed number is in use when the managed pool resolves", () => {
        const { line } = renderPanel("managed_shared", "managed");
        expect(line.textContent ?? "").toContain("managed number");
        // Not the failure copy.
        expect(line.textContent ?? "").not.toContain("unavailable");
    });

    it("still points an own-mode tenant at their own credentials", () => {
        // The old sentence is correct for exactly this case, and must survive:
        // in own mode the credentials panel IS rendered below, and they are the
        // party who can fill it in.
        const { line } = renderPanel("own", "none");
        expect(line.textContent ?? "").toContain("set your provider credentials below");
    });

    it("does not stop offering the managed tier as a promise of no setup", () => {
        // The radio option said "No setup needed" with nothing behind it. It may
        // still say there is nothing for the TENANT to configure — that is true —
        // but not that the tier simply works.
        const { container } = renderPanel("managed_shared", "none");
        const text = container.textContent ?? "";
        expect(text).not.toContain("No setup needed");
        expect(text).toContain("Nothing for you to configure");
    });
});

describe("SMS effective-source line — F59 (semantic colour)", () => {
    it("does not draw a not-configured state in success green", () => {
        for (const mode of ["own", "managed_shared", "managed_dedicated"] as const) {
            const { line } = renderPanel(mode, "none");
            expect(line.className).not.toContain("text-ih-ok-fg");
            expect(line.className).toContain("text-ih-watch-fg");
        }
    });

    it("keeps success green for the states that really are configured", () => {
        // The other half of the discrimination: if the fix had simply made the
        // line amber always, this would fail.
        for (const [mode, source] of [
            ["own", "own"],
            ["platform", "platform"],
            ["managed_shared", "managed"],
        ] as const) {
            const { line } = renderPanel(mode, source);
            expect(line.className).toContain("text-ih-ok-fg");
            expect(line.className).not.toContain("text-ih-watch-fg");
        }
    });

    it("never paints the state with a raw colour", () => {
        // `lint:ds` reads the source; this reads what reached the DOM.
        const { line } = renderPanel("managed_shared", "none");
        expect(line.className).not.toMatch(/text-(\[#|emerald|green|red|amber|yellow|slate)/);
        expect(line.getAttribute("style")).toBeNull();
    });
});
