import React from "react";

export function Button({
  children,
  variant = "primary",
  size = "md",
  iconLeft,
  iconRight,
  fullWidth = false,
  className = "",
  ...props
}) {
  return (
    <button
      className={`ata-btn ata-btn--${variant} ata-btn--${size} ${className}`}
      style={fullWidth ? { width: "100%" } : undefined}
      type={props.type || "button"}
      {...props}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
