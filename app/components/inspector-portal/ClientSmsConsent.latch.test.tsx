// @vitest-environment happy-dom
/**
 * Two attestation submits dispatched in ONE frame record the client's SMS
 * consent once: the attestation is a legal claim and must not be written twice.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";
import { ClientSmsConsent } from "./ClientSmsConsent";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function mount() {
    const calls: string[] = [];
    function Host() {
        const fetcher = useFetcher();
        return <ClientSmsConsent consent="none" fetcher={fetcher as never} attesting={fetcher.state !== "idle"} />;
    }
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: Host,
            action: async ({ request }) => {
                calls.push(String((await request.formData()).get("intent")));
                return null;
            },
        },
    ]);
    const { container } = render(<Stub initialEntries={["/"]} />);
    return { calls, form: container.querySelector("form") as HTMLFormElement };
}

describe("ClientSmsConsent attest latch", () => {
    it("records consent once for two same-frame submits", async () => {
        const { calls, form } = mount();
        act(() => { fireEvent.submit(form); fireEvent.submit(form); });
        await settle();
        expect(calls).toEqual(["attest-sms"]);
    });

    it("CONTROL - submits again once the first has settled", async () => {
        const { calls, form } = mount();
        act(() => { fireEvent.submit(form); });
        await settle();
        act(() => { fireEvent.submit(form); });
        await settle();
        expect(calls).toEqual(["attest-sms", "attest-sms"]);
    });
});
