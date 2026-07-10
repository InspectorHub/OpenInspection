import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { SectionAuthorHeader } from "./SectionAuthorHeader";
import type { TemplateSection } from "./types";

const section: TemplateSection = {
  id: "s1",
  title: "Roof",
  disclaimerText: "",
  items: [{ id: "i1", label: "Item 1", type: "rich" }],
};

test("renders the section title and item count", () => {
  render(
    <SectionAuthorHeader
      section={section}
      activeSection={0}
      renameSection={() => {}}
      updateSections={() => {}}
    />
  );
  expect(screen.getByDisplayValue("Roof")).toBeTruthy();
  expect(screen.getByText("1 items")).toBeTruthy();
});

test("typing in the title input calls renameSection", () => {
  const renameSection = vi.fn();
  render(
    <SectionAuthorHeader
      section={section}
      activeSection={0}
      renameSection={renameSection}
      updateSections={() => {}}
    />
  );
  fireEvent.change(screen.getByDisplayValue("Roof"), { target: { value: "Roof & Attic" } });
  expect(renameSection).toHaveBeenCalledWith(0, "Roof & Attic");
});

test("typing in the disclaimer input calls updateSections", () => {
  const updateSections = vi.fn();
  render(
    <SectionAuthorHeader
      section={section}
      activeSection={0}
      renameSection={() => {}}
      updateSections={updateSections}
    />
  );
  fireEvent.change(screen.getByPlaceholderText("Section disclaimer (optional)"), {
    target: { value: "Roof access was limited." },
  });
  expect(updateSections).toHaveBeenCalledTimes(1);
});
