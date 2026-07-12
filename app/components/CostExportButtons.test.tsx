import { render, screen } from "@testing-library/react";
import { CostExportButtons } from "./CostExportButtons";

describe("CostExportButtons", () => {
  it("renders CSV + Excel download links pointing at the cost-export relay", () => {
    render(<CostExportButtons inspectionId="insp-1" />);
    const csv = screen.getByTestId("cost-export-csv") as HTMLAnchorElement;
    const xlsx = screen.getByTestId("cost-export-xlsx") as HTMLAnchorElement;
    expect(csv.getAttribute("href")).toBe("/resources/cost-export?inspectionId=insp-1&format=csv");
    expect(xlsx.getAttribute("href")).toBe("/resources/cost-export?inspectionId=insp-1&format=xlsx");
    // `download` attribute is the browser save hint (Content-Disposition still wins).
    expect(csv.hasAttribute("download")).toBe(true);
    expect(xlsx.hasAttribute("download")).toBe(true);
  });

  it("url-encodes the inspection id in the relay href", () => {
    render(<CostExportButtons inspectionId="a/b c" />);
    const csv = screen.getByTestId("cost-export-csv") as HTMLAnchorElement;
    expect(csv.getAttribute("href")).toBe("/resources/cost-export?inspectionId=a%2Fb%20c&format=csv");
  });

  it("stamps the variant onto the wrapper testid so the FAB and panel homes are distinguishable", () => {
    const { unmount } = render(<CostExportButtons inspectionId="i" variant="fab" />);
    expect(screen.getByTestId("cost-export-fab")).toBeTruthy();
    unmount();
    render(<CostExportButtons inspectionId="i" variant="panel" />);
    expect(screen.getByTestId("cost-export-panel")).toBeTruthy();
  });
});
