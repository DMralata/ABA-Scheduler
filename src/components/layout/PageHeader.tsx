interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}

export function PageHeader({ title, description, action, breadcrumb }: PageHeaderProps) {
  return (
    <div className="mb-7">
      {breadcrumb && (
        <div
          style={{
            fontSize: 14,
            color: "var(--ata-gray-600)",
            marginBottom: 12,
          }}
        >
          {breadcrumb}
        </div>
      )}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1
            style={{
              fontSize: 28,
              lineHeight: "34px",
              fontWeight: 700,
              color: "var(--ata-gray-900)",
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            {title}
          </h1>
          {description && (
            <p
              style={{
                fontSize: 15,
                lineHeight: "22px",
                color: "var(--ata-gray-600)",
                marginTop: 6,
                marginBottom: 0,
              }}
            >
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
    </div>
  );
}
