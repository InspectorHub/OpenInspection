// @vitest-environment happy-dom
/**
 * The challenge widget wears the theme the PAGE is wearing.
 *
 * Turnstile's `theme` defaults to `auto`, which Cloudflare documents as
 * respecting "the visitor preference" — that is `prefers-color-scheme`, the
 * OS setting. This app's theme is not the OS setting: `oi-color-scheme` is an
 * explicit cookie a visitor chooses (light / dark / field / auto), resolved
 * onto `<html data-color-scheme>` before first paint by the boot script in
 * root.tsx and kept there by `useTheme`.
 *
 * So the two disagree exactly when a visitor has expressed a preference —
 * which is the entire point of having one. A visitor on a dark desktop who
 * sets the app to light got a black Turnstile card sitting in a white booking
 * form, and vice versa. Reported from a screenshot; reproduced here.
 *
 * `field` maps to dark: it is a dark-based scheme (root.tsx gives it the
 * `.dark` class for the same reason) and Turnstile has no third option.
 *
 * Absent or "auto" stays `auto` ON PURPOSE rather than being resolved here.
 * In that mode our own CSS is following `prefers-color-scheme` too, so
 * Turnstile's `auto` already agrees with the page — and it keeps agreeing if
 * the OS flips mid-visit, which a value frozen at render time would not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useTurnstileWidget } from "~/lib/turnstile";

const SITE_KEY = "1x00000000000000000000AA";

let renderSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    renderSpy = vi.fn();
    (window as unknown as { turnstile: unknown }).turnstile = { render: renderSpy };
    // The hook injects the api.js <script> when none is present. One already
    // here keeps happy-dom from reaching for the network; the injection path
    // is not what these cases are about.
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    document.head.appendChild(s);
});

afterEach(() => {
    document.head.querySelectorAll("script").forEach((s) => s.remove());
    document.documentElement.removeAttribute("data-color-scheme");
    delete (window as unknown as { turnstile?: unknown }).turnstile;
});

/** Mounts the hook against a real element and returns the render options. */
function mountWith(
    scheme: string | null,
    opts?: { theme?: "light" | "dark" | "auto" },
): { sitekey: string; theme?: string } {
    if (scheme === null) {
        document.documentElement.removeAttribute("data-color-scheme");
    } else {
        document.documentElement.setAttribute("data-color-scheme", scheme);
    }
    const host = document.createElement("div");
    renderHook(() => useTurnstileWidget(SITE_KEY, { current: host }, 3, () => {}, opts));
    expect(renderSpy).toHaveBeenCalledTimes(1);
    return renderSpy.mock.calls[0][1];
}

describe("useTurnstileWidget theme", () => {
    it("renders a dark widget on a dark page", () => {
        expect(mountWith("dark").theme).toBe("dark");
    });

    // POSITIVE CONTROL: a widget hardcoded to "dark" would pass the case above.
    it("renders a light widget on a light page", () => {
        expect(mountWith("light").theme).toBe("light");
    });

    // `field` is the dark-based high-contrast scheme; Turnstile has no such
    // option, and light would be the wrong half of the choice.
    it("treats the field scheme as dark", () => {
        expect(mountWith("field").theme).toBe("dark");
    });

    // Nothing painted yet ⇒ our CSS is on prefers-color-scheme, and so is
    // Turnstile's own `auto`. Leaving it alone keeps them in step.
    it("defers to Turnstile's own auto when the page has expressed nothing", () => {
        expect(mountWith(null).theme).toBe("auto");
    });

    // The sitekey must survive the change; a theme is not a substitute for it.
    it("still passes the sitekey", () => {
        expect(mountWith("dark").sitekey).toBe(SITE_KEY);
    });

    /**
     * A caller that already knows its palette says so, and is believed.
     *
     * The booking EMBED needs this. It renders inside an iframe on someone
     * else's site and carries its own `style=light|dark|branded` — a value that
     * has nothing to do with the visitor's cookie. It does write that choice
     * onto `<html data-color-scheme>`, but from an effect in the wizard, and a
     * child's effect runs BEFORE its parent's: a widget deriving the theme for
     * itself would read whatever the attribute held a moment earlier. The embed
     * knows the answer outright, so it passes it.
     */
    it("lets a caller that knows its own palette say so", () => {
        expect(mountWith("dark", { theme: "light" }).theme).toBe("light");
    });

    // POSITIVE CONTROL for the override: without one, the page still decides.
    it("still derives from the page when no override is given", () => {
        expect(mountWith("dark", {}).theme).toBe("dark");
    });
});
