import React from "react";

export function DataTable({ columns, rows, selectedRowId, getRowId = (row) => row.id, onRowClick, footer }) {
  return (
    <div className="ata-table-card">
      <table className="ata-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ width: column.width, textAlign: column.align || "left" }}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowId = getRowId(row);
            const selected = selectedRowId === rowId;
            return (
              <tr
                key={rowId}
                className={selected ? "ata-row-selected" : ""}
                onClick={() => onRowClick?.(row)}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} style={{ textAlign: column.align || "left" }}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
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
