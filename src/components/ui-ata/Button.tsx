import * as React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "icon";
type Size = "sm" | "md" | "lg";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  { children, variant = "primary", size = "md", iconLeft, iconRight, fullWidth, className = "", type, ...props },
  ref,
) {
  const cls = [
    "ata-btn",
    `ata-btn--${variant}`,
    size !== "md" ? `ata-btn--${size}` : "",
    fullWidth ? "ata-btn--full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} type={type ?? "button"} className={cls} {...props}>
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
});
