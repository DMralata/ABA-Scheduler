import React from "react";
import { CalendarDays, MessageCircle, Pencil } from "lucide-react";
import { AppShell } from "../../components/app/AppShell";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Chip } from "../../components/ui/Chip";
import { ProgressBar } from "../../components/ui/ProgressBar";

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--ata-gray-100)" }}>
      <span style={{ color: "var(--ata-gray-500)", fontSize: 14 }}>{label}</span>
      <span style={{ color: "var(--ata-gray-900)", fontSize: 14, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="ata-card" style={{ padding: 16, minHeight: 100 }}>
      <div style={{ fontSize: 13, color: "var(--ata-gray-500)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--ata-gray-500)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function ProviderDetailPage() {
  return (
    <AppShell activeNav="providers" sidebarVariant="compact">
      <div className="ata-page">
        <div style={{ fontSize: 14, color: "var(--ata-gray-600)", marginBottom: 18 }}>Providers › Ashley Chen</div>

        <header className="ata-page-header">
          <div>
            <h1 className="ata-page-title">Ashley Chen</h1>
            <p className="ata-page-subtitle">RBT — Registered Behavior Technician</p>
          </div>
          <div className="ata-header-actions">
            <Button variant="secondary" iconLeft={<Pencil size={16} />}>Edit</Button>
            <Button variant="secondary" iconLeft={<MessageCircle size={16} />}>Message</Button>
            <Button iconLeft={<CalendarDays size={16} />}>Schedule</Button>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 24 }}>
          <SummaryCard label="Status" value="Active" />
          <SummaryCard label="Role / Level" value="RBT" sub="Level III" />
          <SummaryCard label="Languages" value="English" sub="Spanish: No" />
          <SummaryCard label="Weekly Target" value="40 hrs" sub="Mon–Fri" />
          <SummaryCard label="Utilization" value="85%" sub="34 / 40 hrs" />
          <SummaryCard label="Service Area" value="Cary, NC" sub="25 mi radius" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "42% 1fr", gap: 24 }}>
          <div style={{ display: "grid", gap: 18 }}>
            <Card title="Details">
              <InfoRow label="Status" value="Active" />
              <InfoRow label="Position" value="RBT" />
              <InfoRow label="RBT Level" value="Level III" />
              <InfoRow label="Gender" value="Female" />
              <InfoRow label="Spanish" value="No" />
              <InfoRow label="Pay Rate" value="$26.00/hr" />
            </Card>
            <Card title="Address">
              <div style={{ lineHeight: 1.6 }}>402 Weston Pkwy<br />Cary, NC, 27513</div>
              <Button variant="ghost" size="sm" style={{ marginTop: 12 }}>View on Map</Button>
            </Card>
            <Card title="Credentials">
              <div style={{ fontWeight: 700 }}>Registered Behavior Technician (RBT)</div>
              <div style={{ color: "var(--ata-gray-500)", fontSize: 13, marginTop: 4 }}>Issued by: BACB</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <Badge variant="active">Valid</Badge>
                <span style={{ color: "var(--ata-gray-600)", fontSize: 13 }}>Expires: 05/31/2026</span>
              </div>
            </Card>
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <Card title="Weekly Availability">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => (
                <InfoRow key={day} label={day} value={index < 5 ? "9am–5pm" : "Unavailable"} />
              ))}
            </Card>

            <Card title="Approved Clients" action={<span style={{ fontSize: 13, color: "var(--ata-gray-500)" }}>10 clients</span>}>
              {[
                ["MJ", "Mia Jackson", "Kaiser"],
                ["CM", "Charlotte Moore", "United Healthcare"],
                ["BC", "Benjamin Clark", "Cigna"],
                ["EJ", "Emma Johnson", "United Healthcare"],
              ].map(([initials, name, payer]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--ata-gray-100)" }}>
                  <span className="ata-avatar">{initials}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{name}</div>
                    <div style={{ color: "var(--ata-gray-500)", fontSize: 13 }}>{payer}</div>
                  </div>
                  <Button variant="ghost" size="sm">View</Button>
                </div>
              ))}
            </Card>

            <Card title="Recent Schedule (This Week)">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800 }}>12</div>
                  <div style={{ color: "var(--ata-gray-500)", fontSize: 13 }}>Assigned Sessions</div>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800 }}>48.0</div>
                  <div style={{ color: "var(--ata-gray-500)", fontSize: 13 }}>Scheduled Hours</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
