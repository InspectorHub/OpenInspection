// @vitest-environment happy-dom
/**
 * The company geocode button calls a paid Places lookup. Two clicks in one frame must reach the
 * action once; a later click after the action settles must go through.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { BookingRoutingPanel, type BookingRoutingConfig } from "./BookingRoutingPanel";

afterEach(cleanup);

const config: BookingRoutingConfig = {
    routingStrategy: "first_available",
    minLeadHours: 0,
    sameDayCutoffTime: null,
    companyAddress: "1 Main St, Austin, TX",
    companyLat: null,
    companyLng: null,
    geocodeAvailable: true,
    originCount: 0,
};

describe("BookingRoutingPanel geocode", () => {
    it("looks the company address up once for a double click", async () => {
        let posts = 0;
        let release: () => void = () => {};
        const Stub = createRoutesStub([
            {
                path: "/",
                Component: () => <BookingRoutingPanel initial={config} anchoredInspectorCount={0} />,
                action: async () => {
                    posts += 1;
                    await new Promise<void>((resolve) => { release = resolve; });
                    return { ok: false, intent: "routing-geocode-company", message: "nope" };
                },
            },
        ]);
        const { container } = render(<Stub initialEntries={["/"]} />);
        const button = await waitFor(() => {
            const input = container.querySelector<HTMLInputElement>('input[value="routing-geocode-company"]');
            expect(input).not.toBeNull();
            return input!.form!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        });
        act(() => { button.click(); button.click(); });
        await waitFor(() => expect(posts).toBe(1));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(posts).toBe(1);
        await act(async () => { release(); });
        await waitFor(() => expect(button.disabled).toBe(false));
        act(() => { button.click(); });
        await waitFor(() => expect(posts).toBe(2));
        await act(async () => { release(); });
    });
});
