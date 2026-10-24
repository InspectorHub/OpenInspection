// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { CostExportButtons } from "./CostExportButtons";

const hrefFor = (format: "csv" | "xlsx") => `/dl/insp-1.${format}`;

describe("CostExportButtons", () => {
  it("renders CSV + Excel download links at the links the caller built", () => {
    render(<CostExportButtons hrefFor={hrefFor} />);
    const csv = screen.getByTestId("cost-export-csv") as HTMLAnchorElement;
    const xlsx = screen.getByTestId("cost-export-xlsx") as HTMLAnchorElement;
    expect(csv.getAttribute("href")).toBe("/dl/insp-1.csv");
    expect(xlsx.getAttribute("href")).toBe("/dl/insp-1.xlsx");
    // `download` attribute is the browser save hint (Content-Disposition still wins).
    expect(csv.hasAttribute("download")).toBe(true);
    expect(xlsx.hasAttribute("download")).toBe(true);
  });

  it("stamps the variant onto the wrapper testid so the FAB and panel homes are distinguishable", () => {
    const { unmount } = render(<CostExportButtons hrefFor={hrefFor} variant="fab" />);
    expect(screen.getByTestId("cost-export-fab")).toBeTruthy();
    unmount();
    render(<CostExportButtons hrefFor={hrefFor} variant="panel" />);
    expect(screen.getByTestId("cost-export-panel")).toBeTruthy();
  });
});
