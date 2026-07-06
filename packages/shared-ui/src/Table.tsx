import React from "react";

export type TableAlign = "left" | "right" | "center";

export interface TableColumn<T> {
  /** Header content. */
  label: React.ReactNode;
  /** Text alignment for this column's header and cells. Defaults to "left". */
  align?: TableAlign;
  /** Custom cell renderer. Falls back to `row[key]` when omitted. */
  cell?: (row: T, index: number) => React.ReactNode;
  /** Key into the row for the default cell renderer and as a stable column id. */
  key?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  /** Rendered in place of the tbody rows when `rows` is empty. */
  empty?: React.ReactNode;
  getRowKey?: (row: T, index: number) => string | number;
  onRowClick?: (row: T, index: number) => void;
  className?: string;
}

const alignClass: Record<TableAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const HEADER_CLASS = "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4";

export function Table<T>({
  columns,
  rows,
  empty,
  getRowKey,
  onRowClick,
  className,
}: TableProps<T>) {
  const isEmpty = rows.length === 0;

  return (
    <table className={`w-full text-left${className ? ` ${className}` : ""}`}>
      <thead>
        <tr className="border-b border-ih-border">
          {columns.map((col, ci) => (
            <th
              key={col.key ?? ci}
              className={`${HEADER_CLASS} ${alignClass[col.align ?? "left"]}`}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {isEmpty ? (
          empty != null ? (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : null
        ) : (
          rows.map((row, ri) => (
            <tr
              key={getRowKey ? getRowKey(row, ri) : ri}
              className={`group border-b border-ih-border hover:bg-ih-bg-muted/50${
                onRowClick ? " cursor-pointer" : ""
              }`}
              onClick={onRowClick ? () => onRowClick(row, ri) : undefined}
            >
              {columns.map((col, ci) => (
                <td
                  key={col.key ?? ci}
                  className={`py-3 px-4 text-[13px] ${alignClass[col.align ?? "left"]}`}
                >
                  {col.cell
                    ? col.cell(row, ri)
                    : col.key
                      ? ((row as Record<string, React.ReactNode>)[col.key] ?? null)
                      : null}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
