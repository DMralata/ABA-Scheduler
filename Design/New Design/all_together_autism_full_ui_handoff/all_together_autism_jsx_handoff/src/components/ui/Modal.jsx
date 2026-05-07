import React from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  title,
  subtitle,
  icon,
  onClose,
  width = 560,
  children,
  footer,
  closeOnOverlayClick = true,
}) {
  if (!open) return null;

  return (
    <div
      className="ata-modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section className="ata-modal" role="dialog" aria-modal="true" style={{ width }}>
        <header className="ata-modal-header">
          <div className="ata-modal-title-row">
            {icon}
            <div>
              <h2 className="ata-modal-title">{title}</h2>
              {subtitle && <p className="ata-modal-subtitle">{subtitle}</p>}
            </div>
          </div>
          <button className="ata-icon-button" type="button" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </header>

        <div className="ata-modal-body">{children}</div>

        {footer && <footer className="ata-modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}
