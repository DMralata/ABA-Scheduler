import Link from "next/link";
import { Plus, Pencil, Repeat } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getRecurringEvents } from "@/lib/queries/recurring";
import { PageHeader } from "@/components/layout/PageHeader";
import { Chip } from "@/components/ui-ata";
import { RemoveRecurringEventButton } from "@/components/recurring/RemoveRecurringEventButton";

const FREQ_LABEL: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
};

const DAY_SHORT: Record<string, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default async function RecurringEventsPage() {
  const center = await prisma.center.findFirst({ select: { id: true } });
  const events = await getRecurringEvents(center?.id);

  return (
    <div>
      <PageHeader
        title="Recurring Events"
        description={`${events.length} recurring event${events.length !== 1 ? "s" : ""}`}
        action={
          <Link href="/recurring/new" className="ata-btn ata-btn--primary">
            <Plus size={16} />
            New recurring event
          </Link>
        }
      />

      {events.length === 0 ? (
        <div
          style={{
            marginTop: 48,
            textAlign: "center",
            color: "var(--ata-gray-500)",
            fontSize: 14,
          }}
        >
          <Repeat size={28} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
          <p style={{ margin: 0 }}>No recurring events yet.</p>
          <Link
            href="/recurring/new"
            style={{
              display: "inline-block",
              marginTop: 8,
              color: "var(--ata-blue-600)",
              fontWeight: 600,
            }}
          >
            Create your first one
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map((ev) => (
            <article
              key={ev.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                padding: "18px 20px",
                background: "#FFFFFF",
                border: "1px solid var(--ata-gray-200)",
                borderRadius: 14,
                boxShadow: "var(--shadow-xs)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--ata-gray-900)",
                    }}
                  >
                    {ev.name}
                  </span>
                  <Chip color="blue">{FREQ_LABEL[ev.frequency]}</Chip>
                  <Chip>{ev.sessionType.name}</Chip>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    fontSize: 14,
                    color: "var(--ata-gray-600)",
                  }}
                >
                  {formatTime(ev.startTime)} – {formatTime(ev.endTime)}
                  {ev.frequency === "WEEKLY" && ev.daysOfWeek.length > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      · {(ev.daysOfWeek as string[]).map((d) => DAY_SHORT[d] ?? d).join(", ")}
                    </span>
                  )}
                  {ev.frequency === "MONTHLY" && ev.dayOfMonth && (
                    <span style={{ marginLeft: 8 }}>· Day {ev.dayOfMonth} of month</span>
                  )}
                </div>

                {ev.providers.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {ev.providers.map(({ provider }) => (
                      <Chip key={provider.id}>
                        {provider.lastName}, {provider.firstName}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <Link
                  href={`/recurring/${ev.id}/edit`}
                  className="ata-btn ata-btn--secondary ata-btn--sm"
                >
                  <Pencil size={14} />
                  Edit
                </Link>
                <RemoveRecurringEventButton id={ev.id} name={ev.name} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
