// @vitest-environment happy-dom
/**
 * The hub settings card: what it renders from loader data, and what a save
 * posts — the same behaviors the editor's settings sheet had, on the hub's
 * own route action. The cover picker is covered by inspection-settings-cover.
 */
import { describe, it, expect, afterEach } from "vitest";
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

interface Call {
    intent: string;
    fields: Record<string, string>;
}

function mount(canEdit = true) {
    const calls: Call[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <InspectionSettingsCard inspectionId="insp-1" initialSettings={SHEET} canEdit={canEdit} />,
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
    it("renders the current template, required fields and profile from loader data", async () => {
        mount();
        await screen.findByTestId("hub-settings-card");
        expect((screen.getByTestId("hub-settings-template") as unknown as HTMLSelectElement).value).toBe("t1");
        expect((screen.getByTestId("hub-settings-required-fields") as unknown as HTMLSelectElement).value).toBe("both");
        expect((screen.getByTestId("hub-settings-profile") as unknown as HTMLSelectElement).value).toBe("meridian");
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

    it("read-only: fields disabled, no save button, no upload", async () => {
        mount(false);
        await screen.findByTestId("hub-settings-card");
        expect((screen.getByTestId("hub-settings-template") as unknown as HTMLSelectElement).disabled).toBe(true);
        expect(screen.queryByTestId("hub-settings-save")).toBeNull();
        expect(screen.queryByText(fieldM.editor_settings_cover_upload())).toBeNull();
    });
});
