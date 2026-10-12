// @vitest-environment happy-dom
/**
 * Two submits of the SMS form dispatched in one frame must reach the fetcher
 * once; the latch releases when the fetcher returns to idle.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import type { FormHTMLAttributes } from "react";
import { SendSmsModal } from "./SendSmsModal";

afterEach(cleanup);

type Fetcher = Parameters<typeof SendSmsModal>[0]["fetcher"];

/** A fetcher whose Form reports a submission only when the handler did not veto it. */
function makeFetcher(state: "idle" | "submitting", submitted: () => void): Fetcher {
    function Form({ onSubmit, ...rest }: FormHTMLAttributes<HTMLFormElement>) {
        return (
            <form
                {...rest}
                onSubmit={(e) => {
                    onSubmit?.(e);
                    if (!e.defaultPrevented) submitted();
                    e.preventDefault();
                }}
            />
        );
    }
    return { state, data: undefined, Form } as unknown as Fetcher;
}

describe("SendSmsModal in-flight latch", () => {
    it("submits once for two same-frame submits, and again after the fetcher is idle", () => {
        const submitted = vi.fn();
        const ui = (state: "idle" | "submitting") => (
            <SendSmsModal people={[]} fetcher={makeFetcher(state, submitted)} onClose={() => {}} />
        );
        const formEl = () => document.getElementById("ih-send-sms-form") as HTMLFormElement;
        const { rerender } = render(ui("idle"));
        act(() => { fireEvent.submit(formEl()); fireEvent.submit(formEl()); });
        expect(submitted).toHaveBeenCalledTimes(1);

        rerender(ui("submitting"));
        rerender(ui("idle"));
        act(() => { fireEvent.submit(formEl()); });
        expect(submitted).toHaveBeenCalledTimes(2);
    });
});
