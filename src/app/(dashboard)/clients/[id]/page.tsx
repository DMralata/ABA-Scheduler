import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarDays, MessageCircle, Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getClientById } from "@/lib/queries/clients";
import { getClientAuthorizations } from "@/lib/queries/authorizations";
import { getWeeklyHoursMap } from "@/lib/queries/sessions";
import { getWeekBoundaries } from "@/lib/utils";
import { ApprovedProvidersPanel } from "@/components/clients/ApprovedProvidersPanel";
import { AuthorizationsPanel } from "@/components/clients/AuthorizationsPanel";
import { ClientAvailabilityPanel } from "@/components/clients/ClientAvailabilityPanel";
import { ClientPreferredSlotsPanel } from "@/components/clients/ClientPreferredSlotsPanel";
import { Badge, Card, Chip } from "@/components/ui-ata";

interface ClientProfilePageProps {
  params: Promise<{ id: string }>;
}

type StatusInfo = {
  label: string;
  variant: "active" | "warning" | "danger";
};

function clientStatus(client: {
  terminationDate: Date | null;
  activeDate: Date;
}): StatusInfo {
  const now = new Date();
  if (client.terminationDate && client.terminationDate <= now) {
    return { label: "Discharged", variant: "danger" };
  }
  if (client.activeDate > now) {
    return { label: "Intake", variant: "warning" };
  }
  return { label: "Active", variant: "active" };
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function ageYears(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
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

export default async function ClientProfilePage({ params }: ClientProfilePageProps) {
  const { id } = await params;
  const [client, authorizations] = await Promise.all([
    getClientById(id),
    getClientAuthorizations(id),
  ]);

  if (!client) notFound();

  const timezone = client.center?.timezone ?? "America/New_York";
  const { weekStart, weekEnd } = getWeekBoundaries(new Date(), timezone);
  const authIds = authorizations.map((a) => a.id);

  const [allProviders, usedHoursMap] = await Promise.all([
    prisma.provider.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        rbtLevel: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    getWeeklyHoursMap(authIds, weekStart, weekEnd),
  ]);

  const status = clientStatus(client);
  const isActive = status.label === "Active" || status.label === "Intake";
  const initials = `${client.firstName[0] ?? ""}${client.lastName[0] ?? ""}`.toUpperCase();
  const age = ageYears(client.dateOfBirth);
  const genderShort =
    client.gender === "FEMALE" ? "F" : client.gender === "MALE" ? "M" : client.gender;

  return (
    <div>
      <div
        style={{
          fontSize: 14,
          color: "var(--ata-gray-600)",
          marginBottom: 16,
        }}
      >
        <Link href="/clients" style={{ color: "inherit" }}>
          Clients
        </Link>
        {" › "}
        <span style={{ color: "var(--ata-gray-900)", fontWeight: 600 }}>
          {client.firstName} {client.lastName}
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
                {client.firstName} {client.lastName}
              </h1>
              <Badge variant={status.variant} dot>
                {status.label}
              </Badge>
              <Chip>
                {age}y · {genderShort}
              </Chip>
            </div>
            <p
              style={{
                fontSize: 14,
                color: "var(--ata-gray-600)",
                marginTop: 6,
                marginBottom: 0,
              }}
            >
              {[
                client.insurance && `Insurance ${client.insurance}`,
                `DOB ${formatDate(client.dateOfBirth)}`,
                `Active since ${formatDate(client.activeDate)}`,
                `ID #${client.id.slice(0, 8)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
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
          <Link href={`/clients/${id}/edit`} className="ata-btn ata-btn--primary">
            <Pencil size={16} />
            Edit
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-5">
        {/* Left col */}
        <div className="col-span-1 space-y-5">
          <Card title="Details">
            <InfoRow
              label="Status"
              value={
                <Badge variant={status.variant} dot>
                  {status.label}
                </Badge>
              }
            />
            <InfoRow label="Gender" value={<span style={{ textTransform: "capitalize" }}>{client.gender.toLowerCase()}</span>} />
            <InfoRow label="Insurance" value={client.insurance ?? "—"} />
            <InfoRow label="Requires Spanish" value={client.spanish ? "Yes" : "No"} />
            <InfoRow
              label="Female provider only"
              value={client.femaleProviderOnly ? "Yes" : "No"}
            />
            <InfoRow
              label="Preferred location"
              value={client.preferredLocation === "HOME" ? "Home" : "Center"}
            />
            {client.minimumRbtLevel && (
              <InfoRow label="Min. RBT level" value={`Level ${client.minimumRbtLevel}`} />
            )}
            <InfoRow label="Active since" value={formatDate(client.activeDate)} />
            {!isActive && client.terminationDate && (
              <InfoRow label="Terminated" value={formatDate(client.terminationDate)} />
            )}
          </Card>

          {(client.street || client.city) && (
            <Card title="Address">
              <p
                style={{
                  fontSize: 14,
                  color: "var(--ata-gray-700)",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {[client.street, client.city, client.state, client.zip]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </Card>
          )}
        </div>

        {/* Right cols */}
        <div className="col-span-2 space-y-5">
          <AuthorizationsPanel
            clientId={client.id}
            authorizations={authorizations}
            usedHoursMap={usedHoursMap}
          />
          <ClientAvailabilityPanel
            clientId={client.id}
            availability={client.availability}
          />
          <ClientPreferredSlotsPanel
            clientId={client.id}
            preferredSlots={client.preferredSlots}
          />
          <ApprovedProvidersPanel
            clientId={client.id}
            approvedProviders={client.approvedHomeProviders}
            allProviders={allProviders}
          />
        </div>
      </div>
    </div>
  );
}
