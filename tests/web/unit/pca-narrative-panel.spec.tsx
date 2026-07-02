import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PcaNarrativePanel } from "~/components/inspection/PcaNarrativePanel";
import type { PcaNarrativeData } from "~/components/portal/sections/report/types";

const narrative: PcaNarrativeData = {
  transmittalLetter: "TL", summaryGeneralDescription: "GD", summaryPhysicalCondition: "PC",
  summaryRecommendations: "REC", purpose: "PURP", scopeOfWork: "SCOPE",
  limitationsExceptions: "LIMITS", reconnaissance: "RECON", additionalConsiderations: "ADDL",
};

describe("PcaNarrativePanel", () => {
  it("renders a textarea per block seeded from the narrative", () => {
    const { getByDisplayValue } = render(<PcaNarrativePanel narrative={narrative} onSave={() => {}} saving={false} />);
    expect(getByDisplayValue("PURP")).toBeTruthy();
    expect(getByDisplayValue("SCOPE")).toBeTruthy();
  });

  it("calls onSave(key, value) on blur with the edited value", () => {
    const onSave = vi.fn();
    const { getByDisplayValue } = render(<PcaNarrativePanel narrative={narrative} onSave={onSave} saving={false} />);
    const ta = getByDisplayValue("PURP");
    fireEvent.change(ta, { target: { value: "edited purpose" } });
    fireEvent.blur(ta);
    expect(onSave).toHaveBeenCalledWith("purpose", "edited purpose");
  });
});
