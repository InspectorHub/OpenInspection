// @vitest-environment happy-dom
/**
 * <RepairDefectRowView> is the one defect presentation shared by the client
 * repair builder and the agent repair-items page. Both portals show the same
 * entity, so they must not drift into two row layouts (that drift is what left
 * photos and the item label off the agent page in the first place).
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { RepairDefectRowView } from "./RepairDefectRowView";

const DEFECT = {
  sectionTitle: "Roof",
  itemLabel: "Shingles",
  defectTitle: "Missing shingles",
  location: "North slope",
  comment: "Replace missing shingles.",
  category: "safety",
};

describe("RepairDefectRowView", () => {
  it("leads with the defect title and keeps the item + section as context", () => {
    const { container } = render(<RepairDefectRowView {...DEFECT} />);
    expect(container.textContent).toContain("Missing shingles");
    expect(container.textContent).toContain("Shingles");
    expect(container.textContent).toContain("Roof");
    expect(container.textContent).toContain("North slope");
    expect(container.textContent).toContain("Replace missing shingles.");
  });

  it("labels the three seeded categories from the message catalog", () => {
    const { container } = render(<RepairDefectRowView {...DEFECT} category="maintenance" />);
    expect(container.textContent).toContain("Maintenance");
  });

  it("echoes a tenant custom category verbatim rather than relabeling it", () => {
    const { container } = render(<RepairDefectRowView {...DEFECT} category="Environmental" />);
    expect(container.textContent).toContain("Environmental");
    expect(container.textContent).not.toContain("Maintenance");
  });

  it("renders a thumbnail per photo when photos are supplied", () => {
    const { container } = render(
      <RepairDefectRowView
        {...DEFECT}
        photos={[
          { key: "t/inspections/i/photos/a.jpg", url: "/api/agent/inspections/i/photo?key=a" },
          { key: "t/inspections/i/photos/b.jpg", url: "/api/agent/inspections/i/photo?key=b" },
        ]}
      />,
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("src")).toBe("/api/agent/inspections/i/photo?key=a");
    // Alt text names the defect so a screen reader hears what the photo shows.
    expect(imgs[0].getAttribute("alt")).toContain("Missing shingles");
  });

  it("renders no photo grid when there are no photos", () => {
    const { container } = render(<RepairDefectRowView {...DEFECT} photos={[]} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("marks a field-added defect as inspector-added", () => {
    const { container } = render(<RepairDefectRowView {...DEFECT} isCustom />);
    expect(container.textContent?.toLowerCase()).toContain("inspector-added");
  });
});
