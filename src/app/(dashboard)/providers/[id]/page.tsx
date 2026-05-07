import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarDays, MessageCircle, Pencil } from "lucide-react";
import { getProviderById } from "@/lib/queries/providers";
import { ProviderAvailabilityPanel } from "@/components/providers/ProviderAvailabilityPanel";
import { ApprovedClientsPanel } from "@/components/providers/ApprovedClientsPanel";
import { Badge, Card, Chip } from "@/components/ui-ata";

interface ProviderProfilePageProps {
  params: Promise<{ id: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ON_LEAVE: "On Leave",
};

const STATUS_VARIANT: Record<string, "active" | "warning" | "danger"> = {
  ACTIVE: "active",
  INACTIVE: "danger",
  ON_LEAVE: "warning",
};

const POSITION_LABEL: Record<string, string> = {
  BCBA: "BCBA — Board Certified Behavior Analyst",
  BCaBA: "BCaBA — Board Certified Assistant Behavior Analyst",
  RBT: "RBT — Registered Behavior Technician",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid var(--ata-gray-100)",
      }}
    >
      <span style={{ color: "var(--ata-gray-500)", fontSize: 14 }}>{label}</span>
      <span
        style={{
          color: "var(--ata-gray-900)",
          fontSize: 14,
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default async function ProviderProfilePage({ params }: ProviderProfilePageProps) {
  const { id } = await params;
  const provider = await getProviderById(id);

  if (!provider) notFound();

  const initials = `${provider.firstName[0] ?? ""}${provider.lastName[0] ?? ""}`.toUpperCase();
  const statusLabel = STATUS_LABELS[provider.status] ?? provider.status;
  const statusVariant = STATUS_VARIANT[provider.status] ?? "active";

  return (
    <div>
      <div
        style={{
          fontSize: 14,
          color: "var(--ata-gray-600)",
          marginBottom: 16,
        }}
      >
        <Link href="/providers" style={{ color: "inherit" }}>
          Providers
        </Link>
        {" › "}
        <span style={{ color: "var(--ata-gray-900)", fontWeight: 600 }}>
          {provider.firstName} {provider.lastName}
        </span>
      </div>

      <header
        className="flex items-center justify-between gap-6 mb-7"
        style={{ flexWrap: "wrap" }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <span
            className="ata-avatar"
            style={{ width: 72, height: 72, fontSize: 22 }}
            aria-hidden
          >
            {initials}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
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
                {provider.firstName} {provider.lastName}
              </h1>
              <Badge variant={statusVariant} dot>
                {statusLabel}
              </Badge>
              <Chip color="blue">{provider.position}</Chip>
              {provider.rbtLevel && <Chip>Level {provider.rbtLevel}</Chip>}
            </div>
            <p
              style={{
                fontSize: 14,
                color: "var(--ata-gray-600)",
                marginTop: 6,
                marginBottom: 0,
              }}
            >
              {POSITION_LABEL[provider.position] ?? provider.position}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/schedule" className="ata-btn ata-btn--secondary">
            <CalendarDays size={16} />
            Schedule
          </Link>
          <Link href="/communications" className="ata-btn ata-btn--secondary">
            <MessageCircle size={16} />
            Message
          </Link>
          <Link href={`/providers/${id}/edit`} className="ata-btn ata-btn--primary">
            <Pencil size={16} />
            Edit
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-1 space-y-5">
          <Card title="Details">
            <InfoRow
              label="Status"
              value={
                <Badge variant={statusVariant} dot>
                  {statusLabel}
                </Badge>
              }
            />
            <InfoRow label="Position" value={provider.position} />
            {provider.rbtLevel && (
              <InfoRow label="RBT level" value={`Level ${provider.rbtLevel}`} />
            )}
            <InfoRow
              label="Gender"
              value={
                <span style={{ textTransform: "capitalize" }}>
                  {provider.gender.toLowerCase()}
                </span>
              }
            />
            <InfoRow label="Spanish" value={provider.spanish ? "Yes" : "No"} />
            {provider.payRateHourly != null && (
              <InfoRow
                label="Pay rate"
                value={`$${provider.payRateHourly.toFixed(2)}/hr`}
              />
            )}
          </Card>

          {(provider.street || provider.city) && (
            <Card title="Address">
              <p
                style={{
                  fontSize: 14,
                  color: "var(--ata-gray-700)",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {[provider.street, provider.city, provider.state, provider.zip]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </Card>
          )}
        </div>

        <div className="col-span-2 space-y-5">
          <ProviderAvailabilityPanel
            providerId={provider.id}
            availability={provider.availability}
          />
          <ApprovedClientsPanel
            providerId={provider.id}
            approvedClients={provider.approvedClients}
          />
        </div>
      </div>
    </div>
  );
}
