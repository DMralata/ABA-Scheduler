import * as React from "react";
import { ChevronDown } from "lucide-react";

export function FilterBar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`ata-filter-bar ${className}`}>{children}</div>;
}

type SelectButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: React.ReactNode;
};

export function SelectButton({ label, className = "", ...props }: SelectButtonProps) {
  return (
    <button
      type="button"
      className={`ata-btn ata-btn--secondary ${className}`}
      style={{ height: 44 }}
      {...props}
    >
      {label}
      <ChevronDown size={16} />
    </button>
  );
}
