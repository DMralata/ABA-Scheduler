import React from "react";

export function Card({ title, action, children, className = "" }) {
  return (
    <section className={`ata-card ${className}`}>
      {(title || action) && (
        <header className="ata-card-header">
          {title && <h2 className="ata-card-title">{title}</h2>}
          {action}
        </header>
      )}
      <div className="ata-card-body">{children}</div>
    </section>
  );
}
