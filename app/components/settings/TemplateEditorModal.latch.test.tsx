// @vitest-environment happy-dom
/**
 * Two submits dispatched in ONE frame must reach the route action once: `pending` only shows after
 * React renders, so the buttons are still live for the second click. A later submit, after the
 * action settles, must go through.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor, fireEvent, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { TemplateEditorModal, type EditorTarget } from "./TemplateEditorModal";

afterEach(cleanup);

let intents: string[] = [];
let release: () => void = () => {};
beforeEach(() => {
    intents = [];
    release = () => {};
});

function mount(target: EditorTarget) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <TemplateEditorModal target={target} onClose={() => {}} />,
            action: async ({ request }) => {
                const form = await request.formData();
                intents.push(String(form.get("intent")));
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: false, intent: String(form.get("intent")), error: "stop" };
            },
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

const newTarget = (channel: "email" | "sms"): EditorTarget => ({ kind: "new", channel, locale: "en", prefill: null });

async function formFor(intent: string): Promise<{ form: HTMLFormElement; button: HTMLButtonElement }> {
    return waitFor(() => {
        const input = document.querySelector<HTMLInputElement>(`input[name="intent"][value="${intent}"]`);
        expect(input).not.toBeNull();
        const form = input!.form!;
        return { form, button: form.querySelector<HTMLButtonElement>('button[type="submit"]')! };
    });
}

function fill(label: RegExp | string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillTemplate() {
    fill(/template name|name/i, "Reminder");
    fill(/body/i, "Hi there");
}

function fillTestTarget(channel: "email" | "sms") {
    const input = document.querySelector<HTMLInputElement>(channel === "email" ? 'input[type="email"]' : 'input[type="tel"]')!;
    fireEvent.change(input, { target: { value: channel === "email" ? "a@example.com" : "+15125550100" } });
}

async function expectOnceThenAgain(intent: string, button: () => HTMLButtonElement) {
    act(() => { button().click(); button().click(); });
    await waitFor(() => expect(intents).toEqual([intent]));
    await act(async () => { release(); });
    await waitFor(() => expect(button().getAttribute("aria-disabled")).not.toBe("true"));
    act(() => { button().click(); });
    await waitFor(() => expect(intents).toEqual([intent, intent]));
    await act(async () => { release(); });
}

describe("TemplateEditorModal same-frame guards", () => {
    it("creates the template once for a double click", async () => {
        mount(newTarget("email"));
        const { button } = await formFor("create");
        fillTemplate();
        await expectOnceThenAgain("create", () => button);
    });

    it("sends the SMS test once for a double click", async () => {
        mount(newTarget("sms"));
        const { button } = await formFor("test-send");
        fillTemplate();
        fillTestTarget("sms");
        await expectOnceThenAgain("test-send", () => button);
    });

    it("sends the email test once even when the second click lands after the human gate has released", async () => {
        mount(newTarget("email"));
        const { button } = await formFor("test-send");
        fillTemplate();
        fillTestTarget("email");
        // Inside one act() React commits nothing, so the fetcher state stays idle throughout. Two timer
        // turns let the gate finish and re-fire the submit; its busy ref is clear again by the next click.
        await act(async () => {
            button.click();
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));
            button.click();
        });
        // Give a second, wrongly admitted submit time to arrive before counting.
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(intents).toEqual(["test-send"]);
        await act(async () => { release(); });
    });
});
