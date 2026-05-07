import React from "react";
import { ChevronDown } from "lucide-react";

export function FilterBar({ children }) {
  return <div className="ata-filter-bar">{children}</div>;
}

export function SelectButton({ label }) {
  return (
    <button type="button" className="ata-btn ata-btn--secondary" style={{ height: 44 }}>
      {label}
      <ChevronDown size={16} />
    </button>
  );
}
