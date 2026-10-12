// @vitest-environment happy-dom
/**
 * Two submits dispatched in one frame must post once; the latch releases when
 * the fetcher returns to idle. The latch lives in the form's onSubmit, so a
 * blocked second submit is observed through the fetcher form's own submit
 * handler: the mocked `fetcher.Form` forwards submits to `formSubmit` only
 * when the component did not preventDefault.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const fetcherMock = vi.hoisted(() => ({ state: "idle" as "idle" | "submitting", posted: vi.fn() }));

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const { createElement } = await import("react");
    function Form(props: React.FormHTMLAttributes<HTMLFormElement>) {
        const { onSubmit, ...rest } = props;
        return createElement("form", {
            ...rest,
            onSubmit: (e: React.SubmitEvent<HTMLFormElement>) => {
                onSubmit?.(e);
                // Stand-in for the router: it posts unless the handler vetoed.
                if (!e.defaultPrevented) fetcherMock.posted();
                e.preventDefault();
            },
        });
    }
    return {
        ...actual,
        useFetcher: () => ({ state: fetcherMock.state, data: undefined, submit: vi.fn(), load: vi.fn(), Form }),
    };
});

vi.mock("~/hooks/useSessionContext", () => ({ useDisplayLocale: () => "en" }));

import { NewInvoiceModal } from "./NewInvoiceModal";

beforeEach(() => {
    fetcherMock.state = "idle";
    fetcherMock.posted.mockReset();
});
afterEach(cleanup);

function ui() {
    return <NewInvoiceModal open onClose={() => {}} inspections={[]} />;
}

function form(): { requestSubmit: () => void } {
    const f = document.querySelector("form");
    if (!f) throw new Error("form not rendered");
    // `clientName` is required, so a real requestSubmit() would stop at validation.
    return { requestSubmit: () => { f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); } };
}

describe("NewInvoiceModal in-flight latch", () => {
    it("posts once when two submits land in one frame", () => {
        render(ui());
        const f = form();
        act(() => { f.requestSubmit(); f.requestSubmit(); });
        expect(fetcherMock.posted).toHaveBeenCalledTimes(1);
    });

    it("releases when the fetcher returns to idle so a failed create can be retried", () => {
        const { rerender } = render(ui());
        act(() => { form().requestSubmit(); form().requestSubmit(); });
        expect(fetcherMock.posted).toHaveBeenCalledTimes(1);
        fetcherMock.state = "submitting";
        rerender(ui());
        fetcherMock.state = "idle";
        rerender(ui());
        act(() => { form().requestSubmit(); });
        expect(fetcherMock.posted).toHaveBeenCalledTimes(2);
    });
});
