import * as React from "react";

export type DataTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
  render: (row: T) => React.ReactNode;
};

type Props<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  selectedRowId?: string | null;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  footer?: React.ReactNode;
  emptyState?: React.ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  selectedRowId,
  getRowId = (row) => (row as { id: string }).id,
  onRowClick,
  footer,
  emptyState,
}: Props<T>) {
  return (
    <div className="ata-table-card">
      <table className="ata-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{ width: column.width, textAlign: column.align ?? "left" }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyState ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: "center", padding: "32px 20px" }}>
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const rowId = getRowId(row);
              const selected = selectedRowId === rowId;
              return (
                <tr
                  key={rowId}
                  className={selected ? "ata-row-selected" : ""}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} style={{ textAlign: column.align ?? "left" }}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {footer && (
        <div
          style={{
            minHeight: 52,
            padding: "0 16px",
            borderTop: "1px solid var(--ata-gray-100)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
