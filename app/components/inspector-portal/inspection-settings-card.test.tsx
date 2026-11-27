// @vitest-environment happy-dom
/**
 * The hub settings card: what it loads, what a save posts, and what the
 * cover picker does — the same behaviors the editor's settings sheet had,
 * on the hub's own route action.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { m as fieldM } from "@core/field-ui/i18n";
import { InspectionSettingsCard } from "./InspectionSettingsCard";

afterEach(cleanup);

const SHEET = {
    inspection: { templateId: "t1", requireDefectFieldsOverride: "both", profileOverride: "meridian", coverPhotoId: "p1" },
    templates: [
        { id: "t1", name: "Full" },
        { id: "t2", name: "Condo" },
    ],
    photos: [
        { key: "p1", url: "https://x/p1", label: "Kitchen" },
        { key: "p2", url: "https://x/p2", label: "Bathroom" },
    ],
    profiles: [
        { id: "signature", name: "Signature" },
        { id: "meridian", name: "Meridian" },
    ],
};

vi.mock("~/lib/field/web-settings-sheet", () => ({
    createWebSettingsSheet: () => ({ load: async () => SHEET }),
}));

interface Call {
    intent: string;
    fields: Record<string, string>;
}

function mount(canEdit = true) {
    const calls: Call[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <InspectionSettingsCard inspectionId="insp-1" canEdit={canEdit} />,
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

describe("InspectionSettingsCard", () => {
    it("loads the current template, required fields, profile and cover", async () => {
        mount();
        await screen.findByTestId("hub-settings-card");
        expect((screen.getByTestId("hub-settings-template") as unknown as HTMLSelectElement).value).toBe("t1");
        expect((screen.getByTestId("hub-settings-required-fields") as unknown as HTMLSelectElement).value).toBe("both");
        expect((screen.getByTestId("hub-settings-profile") as unknown as HTMLSelectElement).value).toBe("meridian");
        const grid = screen.getByTestId("hub-settings-cover-grid");
        expect(grid.querySelectorAll("button")).toHaveLength(2);
        expect(screen.getByTitle(fieldM.editor_settings_cover_current())).toBeTruthy();
    });

    it("saves the form as save-settings with '' as an explicit null, and reports saved", async () => {
        const { calls } = mount();
        await screen.findByTestId("hub-settings-card");
        fireEvent.change(screen.getByTestId("hub-settings-template"), { target: { value: "t2" } });
        fireEvent.change(screen.getByTestId("hub-settings-required-fields"), { target: { value: "" } });
        fireEvent.click(screen.getByTestId("hub-settings-save"));
        await waitFor(() => expect(screen.getByText(fieldM.editor_header_save_saved())).toBeTruthy());
        const save = calls.find((c) => c.intent === "save-settings");
        expect(save).toBeDefined();
        expect(JSON.parse(save!.fields.payload)).toEqual({ templateId: "t2", requireDefectFieldsOverride: null, profileOverride: "meridian" });
    });

    it("clicking the current cover clears it (set-cover with an empty key)", async () => {
        const { calls } = mount();
        await screen.findByTestId("hub-settings-card");
        fireEvent.click(screen.getByTitle(fieldM.editor_settings_cover_current()));
        await waitFor(() => expect(calls.some((c) => c.intent === "set-cover")).toBe(true));
        expect(calls.find((c) => c.intent === "set-cover")!.fields.coverPhotoId).toBe("");
    });

    it("clicking another photo opens the cropper instead of submitting", async () => {
        const { calls } = mount();
        await screen.findByTestId("hub-settings-card");
        fireEvent.click(screen.getByTitle(fieldM.editor_settings_cover_set_labeled({ label: "Bathroom" })));
        await screen.findByRole("dialog", { name: fieldM.media_cover_crop_title() });
        expect(calls).toEqual([]);
    });

    it("read-only: fields disabled, no save button, no upload", async () => {
        mount(false);
        await screen.findByTestId("hub-settings-card");
        expect((screen.getByTestId("hub-settings-template") as unknown as HTMLSelectElement).disabled).toBe(true);
        expect(screen.queryByTestId("hub-settings-save")).toBeNull();
        expect(screen.queryByText(fieldM.editor_settings_cover_upload())).toBeNull();
    });
});
