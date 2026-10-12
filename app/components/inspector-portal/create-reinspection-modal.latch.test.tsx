// @vitest-environment happy-dom
/**
 * Two submits of the create-re-inspection form dispatched in one frame must
 * reach the fetcher once; the latch releases when `submitting` returns to false.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import type { FormHTMLAttributes } from "react";
import { CreateReinspectionModal } from "~/components/inspector-portal/CreateReinspectionModal";

afterEach(cleanup);

type Fetcher = Parameters<typeof CreateReinspectionModal>[0]["fetcher"];

function makeFetcher(submitted: () => void): Fetcher {
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
    return { state: "idle", data: undefined, Form } as unknown as Fetcher;
}

describe("CreateReinspectionModal in-flight latch", () => {
    it("submits once for two same-frame submits, and again after submitting settles", () => {
        const submitted = vi.fn();
        const fetcher = makeFetcher(submitted);
        const ui = (submitting: boolean) => (
            <CreateReinspectionModal
                open
                candidates={[{ itemId: "item-a", label: "Sink", originalNotes: "leak", open: true }]}
                fetcher={fetcher}
                submitting={submitting}
                error={undefined}
                onClose={() => {}}
            />
        );
        const formEl = () => document.getElementById("ih-create-reinspection-form") as HTMLFormElement;
        const { rerender } = render(ui(false));
        act(() => { fireEvent.submit(formEl()); fireEvent.submit(formEl()); });
        expect(submitted).toHaveBeenCalledTimes(1);

        rerender(ui(true));
        rerender(ui(false));
        act(() => { fireEvent.submit(formEl()); });
        expect(submitted).toHaveBeenCalledTimes(2);
    });
});
