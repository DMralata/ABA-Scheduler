import React from "react";
import { CalendarDays, MessageCircle, Pencil } from "lucide-react";
import { AppShell } from "../../components/app/AppShell";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Chip } from "../../components/ui/Chip";
import { SegmentedProgress } from "../../components/ui/ProgressBar";

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--ata-gray-100)" }}>
      <span style={{ color: "var(--ata-gray-500)", fontSize: 14 }}>{label}</span>
      <span style={{ color: "var(--ata-gray-900)", fontSize: 14, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export default function ClientDetailPage() {
  return (
    <AppShell activeNav="clients" sidebarVariant="compact">
      <div className="ata-page">
        <div style={{ fontSize: 14, color: "var(--ata-gray-600)", marginBottom: 18 }}>
          Clients › Active › Olivia Davis
        </div>

        <header className="ata-page-header" style={{ alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span className="ata-avatar" style={{ width: 72, height: 72, fontSize: 22, background: "#8A6F24" }}>OD</span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h1 className="ata-page-title">Olivia Davis</h1>
                <Badge variant="active">Active</Badge>
                <Chip>7y · F</Chip>
              </div>
              <p className="ata-page-subtitle">
                Insurance Blue Cross Blue Shield · Auth 97153 · expires Dec 30, 2027 · Active since Dec 31, 2023 · ID #C-004
              </p>
            </div>
          </div>
          <div className="ata-header-actions">
            <Button variant="secondary" iconLeft={<CalendarDays size={16} />}>Schedule</Button>
            <Button variant="secondary" iconLeft={<MessageCircle size={16} />}>Message</Button>
            <Button iconLeft={<Pencil size={16} />}>Edit</Button>
          </div>
        </header>

        <nav style={{ display: "flex", gap: 24, height: 52, borderBottom: "1px solid var(--ata-gray-200)", marginBottom: 24 }}>
          {["Overview", "Schedule", "Authorizations", "Sessions", "Notes", "Activity"].map((tab, index) => (
            <button
              key={tab}
              type="button"
              style={{
                border: 0,
                background: "transparent",
                borderBottom: index === 0 ? "2px solid var(--ata-gray-900)" : "2px solid transparent",
                fontWeight: index === 0 ? 700 : 600,
                color: index === 0 ? "var(--ata-gray-900)" : "var(--ata-gray-600)",
              }}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div style={{ display: "grid", gridTemplateColumns: "1.45fr .95fr", gap: 24 }}>
          <div style={{ display: "grid", gap: 18 }}>
            <Card title="Authorization usage" action={<Badge variant="warning">92% used</Badge>}>
              <p style={{ marginTop: 0, color: "var(--ata-gray-600)" }}>20 hours/week · expires Dec 30, 2027</p>
              <SegmentedProgress used={18} total={20} />
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--ata-gray-500)", fontSize: 12, marginTop: 10 }}>
                <span>0h</span><span>10h</span><span>20h</span>
              </div>
            </Card>

            <Card title="Recent activity">
              {[
                ["Today", "9:00–11:00am", "Direct therapy · Ashley Chen", "success"],
                ["Apr 26", "9:00–11:00am", "Direct therapy · Ashley Chen", "success"],
                ["Apr 25", "—", "Cancelled · weather", "danger"],
                ["Apr 23", "9:00–11:00am", "Direct therapy · Tyler Johnson", "success"],
                ["Apr 22", "2:00–4:00pm", "Parent training · Sarah Patel", "success"],
              ].map(([date, time, text, type]) => (
                <div key={`${date}-${text}`} style={{ display: "grid", gridTemplateColumns: "80px 120px 1fr", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--ata-gray-100)" }}>
                  <strong style={{ fontSize: 13 }}>{date}</strong>
                  <span style={{ fontSize: 13, color: "var(--ata-gray-500)" }}>{time}</span>
                  <span style={{ fontSize: 14, color: type === "danger" ? "var(--ata-danger-700)" : "var(--ata-gray-800)" }}>{text}</span>
                </div>
              ))}
            </Card>

            <Card title="Weekly availability" action={<Button variant="ghost" size="sm">Edit</Button>}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
                  <div key={day} style={{ border: "1px solid var(--ata-success-100)", background: "var(--ata-success-50)", borderRadius: 8, padding: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--ata-success-700)", fontWeight: 700 }}>{day.toUpperCase()}</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>9–5p</div>
                  </div>
                ))}
                {["Sat", "Sun"].map((day) => (
                  <div key={day} style={{ border: "1px solid var(--ata-gray-200)", background: "var(--ata-gray-50)", borderRadius: 8, padding: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--ata-gray-500)", fontWeight: 700 }}>{day.toUpperCase()}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ata-gray-500)" }}>Off</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <Card title="Care team">
              {[
                ["AC", "Ashley Chen", "RBT · Lvl III", "Primary"],
                ["TJ", "Tyler Johnson", "RBT · Lvl I", "Backup"],
                ["SP", "Sarah Patel", "BCBA", "Supervising"],
              ].map(([initials, name, role, label]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--ata-gray-100)" }}>
                  <span className="ata-avatar">{initials}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{name}</div>
                    <div style={{ color: "var(--ata-gray-500)", fontSize: 13 }}>{role}</div>
                  </div>
                  <Chip color={label === "Primary" ? "blue" : "purple"}>{label}</Chip>
                </div>
              ))}
            </Card>

            <Card title="Preferences" action={<Button variant="ghost" size="sm">Edit</Button>}>
              <InfoRow label="Spanish required" value="No" />
              <InfoRow label="Female provider only" value="No" />
              <InfoRow label="Preferred location" value="Home" />
              <InfoRow label="Min RBT level" value="—" />
            </Card>

            <Card title="Contacts" action={<Button variant="ghost" size="sm">+ Add</Button>}>
              <InfoRow label="Sarah Davis" value="Mother · (919) 555-0142" />
              <InfoRow label="Marcus Davis" value="Father · (919) 555-0188" />
            </Card>

            <Card title="Address">
              <div style={{ color: "var(--ata-gray-700)", lineHeight: 1.6 }}>675 Walnut St<br />Cary, NC 27511</div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
