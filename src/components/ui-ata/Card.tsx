import * as React from "react";

type Props = {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function Card({ title, action, children, className = "", bodyClassName = "" }: Props) {
  return (
    <section className={`ata-card ${className}`}>
      {(title || action) && (
        <header className="ata-card-header">
          {title ? <h2 className="ata-card-title">{title}</h2> : <span />}
          {action}
        </header>
      )}
      <div className={`ata-card-body ${bodyClassName}`}>{children}</div>
    </section>
  );
}
