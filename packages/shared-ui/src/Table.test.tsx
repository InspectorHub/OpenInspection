import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Table } from "@core/shared-ui";

afterEach(cleanup);

interface Row {
  id: number;
  name: string;
  amount: number;
}

const rows: Row[] = [
  { id: 1, name: "Alpha", amount: 10 },
  { id: 2, name: "Beta", amount: 20 },
];

describe("Table", () => {
  it("renders column headers", () => {
    render(
      <Table<Row>
        columns={[{ label: "Name", key: "name" }, { label: "Amount", key: "amount" }]}
        rows={rows}
      />,
    );
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Amount")).toBeTruthy();
  });

  it("renders rows via default cell (row[key])", () => {
    render(
      <Table<Row>
        columns={[{ label: "Name", key: "name" }]}
        rows={rows}
      />,
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("renders rows via custom cell renderer", () => {
    render(
      <Table<Row>
        columns={[{ label: "Amount", cell: (r) => <span>${r.amount}.00</span> }]}
        rows={rows}
      />,
    );
    expect(screen.getByText("$10.00")).toBeTruthy();
    expect(screen.getByText("$20.00")).toBeTruthy();
  });

  it("passes the row index to the cell renderer", () => {
    render(
      <Table<Row>
        columns={[{ label: "#", cell: (_r, i) => <span>idx-{i}</span> }]}
        rows={rows}
      />,
    );
    expect(screen.getByText("idx-0")).toBeTruthy();
    expect(screen.getByText("idx-1")).toBeTruthy();
  });

  it("applies align to header and cells", () => {
    const { container } = render(
      <Table<Row>
        columns={[{ label: "Amount", key: "amount", align: "right" }]}
        rows={rows}
      />,
    );
    const th = container.querySelector("th");
    const td = container.querySelector("td");
    expect(th?.className).toContain("text-right");
    expect(td?.className).toContain("text-right");
  });

  it("renders the empty slot when rows is empty", () => {
    render(
      <Table<Row>
        columns={[{ label: "Name", key: "name" }]}
        rows={[]}
        empty={<div>Nothing here</div>}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
    // No data rows rendered
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("fires onRowClick with the clicked row", () => {
    const onRowClick = vi.fn();
    render(
      <Table<Row>
        columns={[{ label: "Name", key: "name" }]}
        rows={rows}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);
  });

  it("uses the muted DS header style", () => {
    const { container } = render(
      <Table<Row>
        columns={[{ label: "Name", key: "name" }]}
        rows={rows}
      />,
    );
    const th = container.querySelector("th");
    expect(th?.className).toContain("text-[10px]");
    expect(th?.className).toContain("uppercase");
    expect(th?.className).toContain("tracking-widest");
    expect(th?.className).toContain("text-ih-fg-4");
  });
});
