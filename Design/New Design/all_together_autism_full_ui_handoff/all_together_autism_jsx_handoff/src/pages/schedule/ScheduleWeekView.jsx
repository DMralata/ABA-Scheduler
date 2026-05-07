import React from "react";
import { Bell, ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell } from "../../components/app/AppShell";
import { Button } from "../../components/ui/Button";
import { FloatingActionDock } from "../../components/ui/FloatingActionDock";
import { WeekSessionChip } from "../../components/schedule/SessionBlock";

const providers = [
  "Brooks, Devon RBT", "Chen, Ashley RBT", "Johnson, Tyler RBT", "Kim, Jordan BCaBA", "O’Brien, Chris RBT",
  "Park, David BCBA", "Patel, Sarah BCBA", "Rivera, Alex RBT", "Rivera, Marcos RBT", "Rodriguez, Maria RBT",
  "Santos, Jamie RBT", "Test, Garrett BCBA", "Vasquez, Elena RBT", "Williams, Marcus RBT"
];

const clients = ["Anderson, Lucas", "Brown, Sofia", "Clark, Benjamin", "Davis, Olivia", "Gonzalez, Mateo"];

const days = [
  { label: "MON", date: "Apr 27" },
  { label: "TUE", date: "Apr 28" },
  { label: "WED", date: "Apr 29" },
  { label: "THU", date: "Apr 30" },
  { label: "FRI", date: "May 1" },
];

function WeekTopBar() {
  return (
    <header style={{ height: 72, borderBottom: "1px solid var(--ata-gray-200)", display: "flex", alignItems: "center", padding: "0 24px", gap: 12, background: "#FFFFFF" }}>
      <Button variant="secondary" size="sm" iconLeft={<ChevronLeft size={16} />} />
      <Button variant="secondary" size="sm">Today</Button>
      <Button variant="secondary" size="sm" iconLeft={<ChevronRight size={16} />} />
      <div style={{ display: "flex", border: "1px solid var(--ata-gray-200)", borderRadius: 10, overflow: "hidden", marginLeft: 8 }}>
        <button style={{ height: 38, padding: "0 14px", border: 0, background: "#fff", color: "var(--ata-gray-600)", fontWeight: 700 }}>Day</button>
        <button style={{ height: 38, padding: "0 14px", border: 0, background: "var(--ata-blue-600)", color: "#fff", fontWeight: 700 }}>Week</button>
      </div>
      <h1 style={{ fontSize: 18, marginLeft: 12 }}>Apr 27 – May 1, 2026</h1>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 190 }}>
          <div style={{ fontSize: 12, color: "var(--ata-gray-500)", fontWeight: 700 }}>Schedule Efficiency <strong style={{ color: "var(--ata-success-700)" }}>87%</strong></div>
          <div className="ata-progress" style={{ width: 170, marginTop: 6 }}>
            <div className="ata-progress-fill ata-progress-fill--success" style={{ width: "87%" }} />
          </div>
        </div>
        <Button variant="secondary" size="sm" iconLeft={<Bell size={16} />} />
      </div>
    </header>
  );
}

function WeekRow({ name, index, client = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px repeat(5, minmax(220px, 1fr))", minHeight: 38, borderBottom: "1px solid var(--ata-gray-100)" }}>
      <div style={{ padding: "0 12px", display: "flex", alignItems: "center", borderRight: "1px solid var(--ata-gray-200)", background: "#fff", fontSize: 13, fontWeight: 600 }}>
        {name}
      </div>
      {days.map((day, dayIndex) => {
        const show = (index + dayIndex) % 2 === 0 || (client && dayIndex === 2);
        return (
          <div key={day.label} style={{ borderRight: "1px solid var(--ata-gray-100)", minHeight: 38 }}>
            {show && (
              <WeekSessionChip type={(index + dayIndex) % 3 === 0 ? "directTherapy" : "directTherapyHome"} proposed={(index + dayIndex) % 11 === 0}>
                <span>{client ? "Ashley Chen" : clients[(index + dayIndex) % clients.length]}</span>
                <span>{dayIndex < 2 ? "1–5pm" : "9–3:30pm"}</span>
              </WeekSessionChip>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px repeat(5, minmax(220px, 1fr))", height: 36, background: "var(--ata-blue-25)", borderBottom: "1px solid var(--ata-gray-200)", borderTop: "1px solid var(--ata-gray-200)" }}>
      <div style={{ padding: "0 12px", display: "flex", alignItems: "center", fontSize: 13, fontWeight: 800, color: "var(--ata-blue-800)" }}>{title}</div>
    </div>
  );
}

export default function ScheduleWeekView() {
  return (
    <AppShell activeNav="schedule">
      <div style={{ height: "100vh", overflow: "hidden", background: "#FFFFFF" }}>
        <WeekTopBar />
        <main style={{ height: "calc(100vh - 72px)", overflow: "auto" }}>
          <div style={{ minWidth: 1320 }}>
            <div style={{ display: "grid", gridTemplateColumns: "220px repeat(5, minmax(220px, 1fr))", height: 56, position: "sticky", top: 0, background: "#FFFFFF", zIndex: 4, borderBottom: "1px solid var(--ata-gray-200)" }}>
              <div style={{ padding: "0 12px", display: "flex", alignItems: "center", fontWeight: 800, color: "var(--ata-gray-600)" }}>NAME</div>
              {days.map((day) => (
                <div key={day.label} style={{ padding: "8px 12px", borderRight: "1px solid var(--ata-gray-100)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ata-gray-500)" }}>{day.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{day.date}</div>
                </div>
              ))}
            </div>
            <SectionHeader title="Providers" />
            {providers.map((name, index) => <WeekRow key={name} name={name} index={index} />)}
            <SectionHeader title="Clients" />
            {clients.map((name, index) => <WeekRow key={name} name={name} index={index} client />)}
          </div>
        </main>
        <FloatingActionDock actions={["Add session", "Clear week", "Analyze week", "Auto schedule week"]} />
      </div>
    </AppShell>
  );
}
