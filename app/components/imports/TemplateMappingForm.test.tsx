// @vitest-environment happy-dom
/**
 * The template mapping form's save button.
 *
 * The parent raises `busy` only after the click has been handled and React has
 * rendered, so two clicks dispatched in one frame both reach the handler while
 * `busy` still reads false. The form latches synchronously and releases when
 * `busy` returns to false.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import { TemplateMappingForm } from "./TemplateMappingForm";
import type { AdapterInspection, TemplateMapping } from "~/lib/imports-types";

afterEach(cleanup);

const INSPECTION: Extract<AdapterInspection, { kind: "template" }> = {
    kind: "template",
    name: "Roof template",
    sections: 3,
    items: 12,
    ratings: ["Satisfactory", "Marginal"],
    ratingsDescribe: "items",
    ratingsShown: null,
};

const MAPPING: TemplateMapping = { kind: "template", name: "Roof template", ratingKind: "severity" };

const saveButton = () => screen.getByText("Use this template").closest("button") as HTMLButtonElement;

function form(busy: boolean, onApply: (mapping: TemplateMapping) => void) {
    return <TemplateMappingForm inspection={INSPECTION} mapping={MAPPING} busy={busy} onApply={onApply} />;
}

describe("TemplateMappingForm — the in-flight latch", () => {
    it("applies once when two clicks land in the same frame", () => {
        const onApply = vi.fn();
        render(form(false, onApply));
        const btn = saveButton();
        act(() => {
            btn.click();
            btn.click();
        });
        expect(onApply).toHaveBeenCalledTimes(1);
    });

    it("applies again once busy has returned to false", () => {
        const onApply = vi.fn();
        const view = render(form(false, onApply));
        const btn = saveButton();
        act(() => {
            btn.click();
            btn.click();
        });
        expect(onApply).toHaveBeenCalledTimes(1);

        view.rerender(form(true, onApply));
        view.rerender(form(false, onApply));
        fireEvent.click(saveButton());
        expect(onApply).toHaveBeenCalledTimes(2);
    });
});
