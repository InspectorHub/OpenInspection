// @vitest-environment happy-dom
/**
 * The hub settings card's cover picker: what the grid shows, what picking
 * the current cover posts, and what picking another photo opens.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { m as fieldM } from "@core/field-ui/i18n";
import { InspectionSettingsCover } from "./InspectionSettingsCover";

afterEach(cleanup);

const PHOTOS = [
    { key: "p1", url: "https://x/p1", label: "Kitchen" },
    { key: "p2", url: "https://x/p2", label: "Bathroom" },
];

interface Call {
    intent: string;
    fields: Record<string, string>;
}

function mount(canEdit = true) {
    const calls: Call[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <InspectionSettingsCover inspection={{ coverPhotoId: "p1" }} initialPhotos={PHOTOS} initialCoverKey="p1" canEdit={canEdit} />,
            action: async ({ request }) => {
                const fd = await request.formData();
                const fields: Record<string, string> = {};
                for (const [k, v] of fd.entries()) fields[k] = String(v);
                const intent = fields.intent ?? "";
                calls.push({ intent, fields });
                if (intent === "upload-cover") return { ok: true, intent, coverKey: "p3", coverUrl: "https://x/p3" };
                return { ok: true, intent };
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return { calls };
}

describe("InspectionSettingsCover", () => {
    it("shows the photos with the current cover marked", async () => {
        mount();
        const grid = await screen.findByTestId("hub-settings-cover-grid");
        expect(grid.querySelectorAll("button")).toHaveLength(2);
        expect(screen.getByTitle(fieldM.editor_settings_cover_current())).toBeTruthy();
    });

    it("clicking the current cover clears it (set-cover with an empty key)", async () => {
        const { calls } = mount();
        await screen.findByTestId("hub-settings-cover-grid");
        fireEvent.click(screen.getByTitle(fieldM.editor_settings_cover_current()));
        await waitFor(() => expect(calls.some((c) => c.intent === "set-cover")).toBe(true));
        expect(calls.find((c) => c.intent === "set-cover")!.fields.coverPhotoId).toBe("");
    });

    it("clicking another photo opens the cropper instead of submitting", async () => {
        const { calls } = mount();
        await screen.findByTestId("hub-settings-cover-grid");
        fireEvent.click(screen.getByTitle(fieldM.editor_settings_cover_set_labeled({ label: "Bathroom" })));
        await screen.findByRole("dialog", { name: fieldM.media_cover_crop_title() });
        expect(calls).toEqual([]);
    });
});
