import * as React from "react";
import { Search } from "lucide-react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  shortcut?: string;
  containerStyle?: React.CSSProperties;
  containerClassName?: string;
};

export const SearchInput = React.forwardRef<HTMLInputElement, Props>(function SearchInput(
  { placeholder = "Search...", shortcut, containerStyle, containerClassName = "", ...props },
  ref,
) {
  return (
    <div className={`ata-search ${containerClassName}`} style={containerStyle}>
      <Search className="ata-search-icon" size={18} />
      <input ref={ref} className="ata-input" placeholder={placeholder} {...props} />
      {shortcut && <span className="ata-kbd">{shortcut}</span>}
    </div>
  );
});
