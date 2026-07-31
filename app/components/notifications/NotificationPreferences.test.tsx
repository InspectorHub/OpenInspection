/**
 * The three choices §4 makes are the three things worth asserting, because each
 * one is a place where the obvious implementation would quietly lie to the
 * reader.
 *
 * These test what a reader SEES and what a click DOES — not which components
 * were used. A rewrite that keeps the promises should pass.
 *
 * WHAT THESE CANNOT TELL YOU. `user-event` refuses to click an element with
 * `pointer-events: none`, which reads like a reachability check — and here it
 * mostly is not one. Vitest loads no Tailwind CSS, so a `pointer-events-none`
 * CLASS has nothing behind it and the click goes through; only an inline style
 * is caught (both verified). Real unreachability in this codebase comes from
 * classes and overlays, so it is invisible at this level. Whether the control
 * can actually be reached, and whether it is legible in both themes, is a
 * question only the Chrome walkthrough answers.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationPreferences } from "./NotificationPreferences";

const ALWAYS = [
    { id: "password-reset", label: "Password reset", channels: ["email"] },
    { id: "report-ready", label: "Your report is ready", channels: ["email"] },
];

const CHOOSE = [
    {
        id: "booking-confirmation",
        label: "Booking confirmation",
        channels: { email: "on", sms: "off", in_app: "unavailable" },
    },
    {
        id: "review-request",
        label: "How did we do?",
        channels: { email: "off", sms: "unavailable", in_app: "unavailable" },
    },
] as const;

const user = userEvent.setup();

const renderScreen = (onChange = vi.fn()) => {
    render(
        <NotificationPreferences
            alwaysSent={ALWAYS}
            youChoose={CHOOSE.map((r) => ({ ...r, channels: { ...r.channels } }))}
            onChange={onChange}
        />,
    );
    return onChange;
};

describe("NotificationPreferences", () => {
    it("offers no switch at all for what is always sent", async () => {
        // A greyed-out toggle invites the reader to try, then refuses. The
        // always-sent group answers the question instead of posing it, so there
        // must be nothing there to click.
        renderScreen();
        await user.click(screen.getByText(/show what these are/i));

        const alwaysItem = screen.getByText("Password reset").closest("li")!;
        expect(within(alwaysItem).queryByRole("checkbox")).toBeNull();
    });

    it("tells the reader how many they cannot switch off", () => {
        // §4: a number a reader can hold beats a sentence they have to trust.
        renderScreen();
        const always = screen.getByRole("region", { name: /always sent/i });
        expect(within(always).getByText(String(ALWAYS.length))).toBeInTheDocument();
        expect(within(always).getByText(/cannot be switched off/i)).toBeInTheDocument();
    });

    it("shows a dash, not an empty switch, for a channel the notification never uses", () => {
        // The distinction that matters: "off" is a choice the reader made,
        // "—" is a form that does not exist. An unchecked box would invite them
        // to turn on something that can never happen.
        renderScreen();
        const row = screen.getAllByRole("row").find((r) => within(r).queryByText("How did we do?"))!;
        // email is a real control; the other two are not controls at all.
        expect(within(row).getAllByRole("checkbox")).toHaveLength(1);
        expect(within(row).getAllByText("—")).toHaveLength(2);
    });

    it("reports which notification and which channel a click was about", async () => {
        const onChange = renderScreen();
        await user.click(screen.getByRole("checkbox", { name: /booking confirmation — text/i }));
        expect(onChange).toHaveBeenCalledWith("booking-confirmation", "sms", true);
    });

    it("turns something off as readily as on — the control is not one-way", async () => {
        const onChange = renderScreen();
        await user.click(screen.getByRole("checkbox", { name: /booking confirmation — email/i }));
        expect(onChange).toHaveBeenCalledWith("booking-confirmation", "email", false);
    });

    it("names every switch by its notification, so a screen reader is not left with three 'email's", () => {
        renderScreen();
        for (const box of screen.getAllByRole("checkbox")) {
            expect(box.getAttribute("aria-label")).toMatch(/ — /);
        }
    });

    it("stops accepting clicks while a save is in flight", () => {
        render(
            <NotificationPreferences
                alwaysSent={ALWAYS}
                youChoose={CHOOSE.map((r) => ({ ...r, channels: { ...r.channels } }))}
                onChange={vi.fn()}
                busy
            />,
        );
        for (const box of screen.getAllByRole("checkbox")) {
            expect(box).toBeDisabled();
        }
    });
});
