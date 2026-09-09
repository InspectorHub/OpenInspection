// @vitest-environment happy-dom
/**
 * The embedded booking form carries a bot challenge, like every other
 * anonymous submission surface.
 *
 * IT NEVER DID, AND THAT WAS NOT MERELY A GAP IN PROTECTION.
 *
 * `EmbedData.siteKey` was declared, populated by the loader from
 * `resolveTurnstileSiteKey`, handed to this component — and never read. The
 * form then posted `turnstileToken: fd.get("cf-turnstile-response")`, which is
 * always null because no widget had ever written that hidden input.
 *
 * Meanwhile the server always demanded one. `resolveTurnstile` reports
 * `enforced` unconditionally on saas (`botProtectionMandatory: true`, on
 * Cloudflare's published test secret when none is configured), and
 * `admitBooking` answers a missing token with
 * `Forbidden('Security verification token missing.')`. Measured against a
 * running worker with enforcement on: the exact payload this form sends
 * returns HTTP 403, and the same payload with any token gets past the gate.
 *
 * So on the hosted product this form could not take a booking at all. It is
 * precisely the failure `resolveTurnstileSiteKey`'s own comment names — "a
 * page rendering no widget against a server that demands a token is a booking
 * form nobody can submit" — reached from the other side: the site key was
 * resolved correctly and then dropped on the floor.
 *
 * The standalone default is the other half: no secret configured means
 * `enforced` is false and the server asks for nothing, so an embed with no
 * site key must keep submitting exactly as it did.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, fireEvent, waitFor, screen } from "@testing-library/react";

import { EmbedWizard, type EmbedData } from "~/routes/public/booking-embed-widget";

const DATA: EmbedData = {
    slug: "",
    inspectorId: "",
    inspectorName: "Seed Tenant A",
    tenantSlug: "seed-a",
    siteKey: "1x00000000000000000000AA",
    theme: "light",
    brand: null,
    bookingOpen: true,
    privacyUrl: null,
    termsUrl: null,
};

/** Fires the solved-callback so a test can hand the form a real token. */
let solve: ((token: string) => void) | null = null;
let renderOpts: { sitekey: string; theme?: string } | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    solve = null;
    renderOpts = null;
    (window as unknown as { turnstile: unknown }).turnstile = {
        render: (_el: HTMLElement, opts: { sitekey: string; theme?: string; callback: (t: string) => void }) => {
            renderOpts = opts;
            solve = opts.callback;
        },
    };
    // The hook injects api.js when no turnstile script is present; one here
    // keeps happy-dom off the network.
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    document.head.appendChild(s);

    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    document.head.querySelectorAll("script").forEach((el) => el.remove());
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    vi.unstubAllGlobals();
});

function renderEmbed(over: Partial<EmbedData> = {}) {
    render(<EmbedWizard data={{ ...DATA, ...over }} error={null} />);
}

/** Fills every required field so only the challenge is ever in question. */
function fillRequired() {
    fireEvent.change(document.querySelector('input[name="address"]')!, {
        target: { value: "88 Juniper Lane, Springfield" },
    });
    fireEvent.change(document.querySelector('input[name="clientName"]')!, {
        target: { value: "Dana Buyer" },
    });
    fireEvent.change(document.querySelector('input[name="clientEmail"]')!, {
        target: { value: "dana.buyer@example.com" },
    });
    fireEvent.change(document.querySelector('input[name="date"]')!, {
        target: { value: "2026-06-18" },
    });
}

function submit() {
    fireEvent.submit(document.querySelector("form")!);
}

/** The one booking POST, or undefined when none was made. */
function bookingCall() {
    return fetchMock.mock.calls.find(([url]) => String(url).includes("/api/public/book"));
}

/** The JSON body of the one booking POST, or null when none was made. */
function postedBody(): Record<string, unknown> | null {
    const call = bookingCall();
    return call ? JSON.parse(call[1].body) : null;
}

/** The URL of the one booking POST, or null when none was made. */
function postedUrl(): string | null {
    const call = bookingCall();
    return call ? String(call[0]) : null;
}

describe("embedded booking form: bot challenge", () => {
    it("mounts a challenge against the site key the loader resolved", () => {
        renderEmbed();
        expect(renderOpts).not.toBeNull();
        expect(renderOpts!.sitekey).toBe("1x00000000000000000000AA");
    });

    it("sends the solved token, so the server's gate can pass", async () => {
        renderEmbed();
        // The provider calls back outside React; flush that state like React would.
        act(() => solve!("tok_from_widget"));
        fillRequired();
        submit();
        await waitFor(() => expect(postedBody()).not.toBeNull());
        expect(postedBody()!.turnstileToken).toBe("tok_from_widget");
    });

    // Same lesson as the main booking form: the submit stays usable and says
    // why, rather than posting a payload the server is certain to refuse.
    it("does not post a request it knows will be refused, and says why", async () => {
        renderEmbed();
        fillRequired();
        submit();
        await waitFor(() => expect(screen.getByText(/verification/i)).toBeTruthy());
        expect(postedBody()).toBeNull();
        expect((screen.getByRole("button", { name: /book|request|submit/i }) as HTMLButtonElement).disabled).toBe(false);
    });

    /**
     * POSITIVE CONTROL, and a real deployment shape rather than a hypothetical.
     *
     * A standalone operator who configured no secret gets `enforced: false`
     * server-side and a null site key from the loader. Nothing may be demanded
     * of them — a form that started refusing to submit here would be a
     * regression dressed up as a security fix.
     */
    it("submits with no challenge at all when the deployment configured none", async () => {
        renderEmbed({ siteKey: "" });
        expect(renderOpts).toBeNull();
        fillRequired();
        submit();
        await waitFor(() => expect(postedBody()).not.toBeNull());
        expect(postedBody()!.turnstileToken).toBeUndefined();
    });

    /**
     * The embed's palette is the HOST site's choice (`?style=`), not the
     * visitor's, and it reaches `<html data-color-scheme>` from an effect in
     * the wizard — a parent, whose effect runs AFTER this child's. So the
     * widget is told outright instead of deriving it a moment too early.
     */
    it("dresses the challenge in the embed's declared style, not the page's", () => {
        renderEmbed({ theme: "dark" });
        expect(renderOpts!.theme).toBe("dark");
    });

    // `branded` renders light with the tenant's accent tokens (see the loader),
    // and Turnstile has no third option, so it must resolve to light.
    it("treats the branded style as light", () => {
        renderEmbed({ theme: "branded" });
        expect(renderOpts!.theme).toBe("light");
    });

    /**
     * The form says what it is, so the tenant's origin allowlist can apply.
     *
     * `admitBooking` gates that allowlist on `c.req.query('embed') === '1'`.
     * This form posted to a bare `/api/public/book`, so the flag was never set
     * and `widget.isOriginAllowed` had never once run for a booking — a
     * tenant-facing restriction that never executed. The server half now
     * enforces only an allowlist a tenant actually configured, so declaring
     * this cannot lock anyone out; see the admission spec for that half.
     */
    it("identifies itself as a widget submission", async () => {
        renderEmbed();
        act(() => solve!("tok"));
        fillRequired();
        submit();
        await waitFor(() => expect(postedUrl()).not.toBeNull());
        expect(postedUrl()).toContain("embed=1");
    });
});
