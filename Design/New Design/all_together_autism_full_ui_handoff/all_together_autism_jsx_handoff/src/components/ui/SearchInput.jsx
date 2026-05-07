import React from "react";
import { Search } from "lucide-react";

export function SearchInput({ placeholder = "Search...", shortcut, style, ...props }) {
  return (
    <div className="ata-search" style={style}>
      <Search className="ata-search-icon" size={18} />
      <input className="ata-input" placeholder={placeholder} {...props} />
      {shortcut && <span className="ata-kbd">{shortcut}</span>}
    </div>
  );
}
