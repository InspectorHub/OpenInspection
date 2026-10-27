// @vitest-environment happy-dom
/** The controls that write, one by one: each is in the page normally and absent in a read-only editor. */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { FieldDataSourceProvider } from "../../context";
import { m } from "../../i18n";
import { ReadOnlyScope } from "../../read-only";
import { createEmptyEditorData, createFakeCommentsLibrary, createFakeDataSource } from "../../testing/fake-data-source";
import { InspectorToolsDock } from "./InspectorToolsDock";
import { MobileFinishDrawer } from "./MobileFinishDrawer";
import { PropertyInfoForm } from "./PropertyInfoForm";
import { ReadOnlyItemView } from "./ReadOnlyItemView";
import { SideRail } from "./SideRail";

afterEach(cleanup);

function mount(readOnly: boolean, ui: ReactNode) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { commentsLibrary: createFakeCommentsLibrary() } });
  return render(
    <FieldDataSourceProvider dataSource={fake}>
      <ReadOnlyScope readOnly={readOnly}>{ui}</ReadOnlyScope>
    </FieldDataSourceProvider>,
  );
}

describe.each([[false], [true]])("readOnly=%s", (readOnly) => {
  const has = (present: boolean) => (readOnly ? !present : present);

  it("PropertyInfoForm: inputs and the fetch button are offered only when it can write", () => {
    mount(readOnly, <PropertyInfoForm inspection={{ id: "i1", propertyAddress: "1 Main St", yearBuilt: 1990 }} onSave={() => undefined} onCommit={() => undefined} />);
    expect(!!document.querySelector("input")).toBe(has(true));
    expect(!!screen.queryByRole("button", { name: m.editor_property_autofill_button() })).toBe(has(true));
    expect(screen.queryByTestId("property-value-yearBuilt")?.textContent ?? null).toBe(readOnly ? "1990" : null);
  });

  it("SideRail: the comment library tab is offered only when it can write", () => {
    mount(readOnly, <SideRail locale="en-US" mode="fill" initialOpen activeItem={{ id: "i1", label: "Item", type: "rich" }} activeResult={{}} inspectionId="i1" />);
    expect(!!screen.queryByRole("button", { name: /Library/ })).toBe(has(true));
  });

  it("MobileFinishDrawer: Publish and Sign are offered only when it can write; Preview stays", () => {
    mount(readOnly, <MobileFinishDrawer open onClose={() => undefined} onPublish={() => undefined} onSign={() => undefined} onOpenSettings={null} onFinishFieldwork={null} finishingFieldwork={false} onPreviewReport={() => undefined} />);
    const sheet = screen.getByRole("dialog");
    expect(!!within(sheet).queryByRole("button", { name: m.editor_header_publish() })).toBe(has(true));
    expect(!!within(sheet).queryByRole("button", { name: m.editor_header_sign() })).toBe(has(true));
    expect(within(sheet).queryByRole("button", { name: m.editor_header_preview_report() })).not.toBeNull();
  });

  it("InspectorToolsDock: speed, burst and photo studio are offered only when it can write; shortcuts stay", () => {
    mount(readOnly, <InspectorToolsDock activeItemId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: m.editor_dock_open() }));
    expect(!!screen.queryByRole("menuitem", { name: new RegExp(m.editor_dock_speed_mode()) })).toBe(has(true));
    expect(!!screen.queryByRole("menuitem", { name: new RegExp(m.editor_dock_photo_studio()) })).toBe(has(true));
    expect(screen.queryByRole("menuitem", { name: new RegExp(m.editor_shortcuts_label()) })).not.toBeNull();
  });
});

describe("ReadOnlyItemView", () => {
  const item = {
    id: "i1", label: "Flashing", type: "rich",
    tabs: {
      information: [{ id: "n1", title: "Material", comment: "{{brand}} flashing", default: false }, { id: "n2", title: "No visible defects", comment: "None seen.", default: true }],
      limitations: [{ id: "l1", title: "Snow cover", comment: "Part of the roof was snow covered.", default: false }],
      defects: [{ id: "d1", title: "Loose flashing", comment: "At {{location}}.", default: false }],
    },
  };
  const result = {
    rating: "def", notes: "Granule loss.\nSecond line.",
    attributes: { brand: "Acme" },
    tabs: { defects: [{ cannedId: "d1", included: true, location: "north eave" }], information: [{ cannedId: "n1", included: true }], limitations: [{ cannedId: "l1", included: false }] },
    customComments: { defects: [{ id: "c1", title: "Cracked cap", comment: "Needs sealing.", included: true }, { id: "c2", title: "Hidden", comment: "x", included: false }, { id: "c3", title: "Legacy row", comment: "No flag stored." }] },
    photos: [{ key: "t/i/a.jpg" }],
  };

  it("prints the rating, the notes, the included comments and the photos, and nothing that is not included", () => {
    mount(true, <ReadOnlyItemView item={item} sectionTitle="Roofing" result={result} ratingLevels={[{ id: "def", label: "Defect" }]} inspectionId="i1" coverKey={null} />);
    expect(screen.getByTestId("read-only-rating").textContent).toBe("Defect");
    expect(screen.getByTestId("read-only-notes").textContent).toBe("Granule loss.\nSecond line.");
    expect(within(screen.getByTestId("read-only-defects")).getByText("Loose flashing")).toBeTruthy();
    expect(screen.getByText("At north eave.")).toBeTruthy();
    expect(screen.getByText("Cracked cap")).toBeTruthy();
    expect(screen.getByText("Needs sealing.")).toBeTruthy();
    expect(screen.getByText("Legacy row")).toBeTruthy(); // a custom defect with no stored flag counts as included, as in the editor and the report
    expect(screen.getByText("{{brand}} flashing")).toBeTruthy(); // information is printed as written, as the report does
    expect(screen.queryByText("Snow cover")).toBeNull();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.getByTestId("thumb-0")).toBeTruthy();
  });

  it("includes an entry the template has on by default when nobody touched it, and keeps the tabs apart", () => {
    mount(true, <ReadOnlyItemView item={item} sectionTitle="Roofing" result={result} ratingLevels={[]} inspectionId="i1" coverKey={null} />);
    const info = screen.getByTestId("read-only-information");
    expect(within(info).getByText("No visible defects")).toBeTruthy();
    expect(within(info).getByText("None seen.")).toBeTruthy();
    expect(within(info).queryByText("Loose flashing")).toBeNull();
    expect(screen.queryByTestId("read-only-limitations")).toBeNull();
  });

  it("fills in only a defect's prose, uses the inspector's own wording when there is one, and treats an undefined included as untouched", () => {
    const mixed = {
      ...result,
      tabs: {
        information: [{ cannedId: "n1", included: true, comment: "Own wording for {{brand}}" }, { cannedId: "n2" }],
        limitations: [],
        defects: [{ cannedId: "d1", included: true, comment: "Own defect text at {{location}} on {{brand}}", location: "" }],
      },
    };
    const withLocation = { ...item, tabs: { ...item.tabs, defects: [{ id: "d1", title: "Loose flashing", comment: "x", default: false, location: "south wall" }] } };
    mount(true, <ReadOnlyItemView item={withLocation} sectionTitle="Roofing" result={mixed} ratingLevels={[]} inspectionId="i1" coverKey={null} />);
    expect(screen.getByText("Own wording for {{brand}}")).toBeTruthy();
    expect(screen.getByText("Own defect text at south wall on Acme")).toBeTruthy();
    expect(screen.getByText("No visible defects")).toBeTruthy();
  });

  it("CONTROL - a default entry the inspector switched off is not shown", () => {
    const off = { ...result, tabs: { ...result.tabs, information: [{ cannedId: "n2", included: false }, { cannedId: "n1", included: true }] } };
    mount(true, <ReadOnlyItemView item={item} sectionTitle="Roofing" result={off} ratingLevels={[]} inspectionId="i1" coverKey={null} />);
    expect(screen.queryByText("No visible defects")).toBeNull();
  });

  it("has no input, no button that writes and no add tile", () => {
    mount(true, <ReadOnlyItemView item={item} sectionTitle="Roofing" result={result} ratingLevels={[]} inspectionId="i1" coverKey={null} />);
    expect(document.querySelector("textarea, input, select")).toBeNull();
    expect(screen.queryByTestId("photo-add")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
