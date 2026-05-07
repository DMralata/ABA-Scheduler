import React from "react";
import { Bell, ChevronLeft, ChevronRight, Filter, Search } from "lucide-react";
import { AppShell } from "../../components/app/AppShell";
import { Button } from "../../components/ui/Button";
import { FloatingActionDock } from "../../components/ui/FloatingActionDock";
import { SessionBlock } from "../../components/schedule/SessionBlock";

const clients = [
  "Anderson, Lucas", "Brown, Sofia", "Clark, Benjamin", "Davis, Olivia", "Gonzalez, Mateo", "Harris, Ethan",
  "Jackson, Mia", "Johnson, Emma", "Lee, James", "Lewis, Amelia", "Martinez, Aiden", "Moore, Charlotte",
  "Rivera, Alexia", "Thompson, Ava", "Torres, Liam", "White, Isabella", "Williams, Noah"
];

const providers = [
  "Brooks, Devon RBT", "Chen, Ashley RBT", "Johnson, Tyler RBT", "Kim, Walter BCBA", "Patel, Lauren RBT", "Smith, Natalie BCBA"
];

const timeCols = ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM"];

function ScheduleTopBar() {
  return (
    <header style={{ height: 72, borderBottom: "1px solid var(--ata-gray-200)", display: "flex", alignItems: "center", padding: "0 24px", gap: 12, background: "#FFFFFF" }}>
      <Button variant="secondary" size="sm" iconLeft={<ChevronLeft size={16} />} />
      <Button variant="secondary" size="sm">Today</Button>
      <Button variant="secondary" size="sm" iconLeft={<ChevronRight size={16} />} />
      <Button variant="secondary" size="sm">Wed, Apr 29, 2026</Button>
      <div style={{ display: "flex", border: "1px solid var(--ata-gray-200)", borderRadius: 10, overflow: "hidden", marginLeft: 8 }}>
        <button style={{ height: 38, padding: "0 14px", border: 0, background: "var(--ata-blue-600)", color: "#fff", fontWeight: 700 }}>Day</button>
        <button style={{ height: 38, padding: "0 14px", border: 0, background: "#fff", color: "var(--ata-gray-600)", fontWeight: 700 }}>Week</button>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <div className="ata-input" style={{ width: 320, display: "flex", alignItems: "center", gap: 8 }}>
          <Search size={16} color="var(--ata-gray-400)" />
          <span style={{ color: "var(--ata-gray-400)" }}>Search clients, providers, locations...</span>
        </div>
        <Button variant="secondary" size="sm" iconLeft={<Filter size={16} />} />
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 12, color: "var(--ata-gray-500)", fontWeight: 700 }}>Schedule efficiency <strong style={{ color: "var(--ata-success-700)" }}>77%</strong></div>
          <div className="ata-progress" style={{ width: 160, marginTop: 6 }}>
            <div className="ata-progress-fill ata-progress-fill--success" style={{ width: "77%" }} />
          </div>
        </div>
        <Button variant="secondary" size="sm" iconLeft={<Bell size={16} />} />
        <span className="ata-avatar">AK</span>
      </div>
    </header>
  );
}

function FilterPanel() {
  const types = ["Admin", "Assessment", "Break", "Cancellation", "Direct Therapy", "Direct Therapy Home", "Drive Time", "Lunch", "Nap", "Parent Training", "Supervision"];
  return (
    <aside style={{ width: 240, borderRight: "1px solid var(--ata-gray-200)", background: "#FFFFFF", padding: 20, overflowY: "auto" }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>Filters</h3>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ata-gray-500)", marginBottom: 12 }}>SESSION TYPES</div>
      {types.map((type, index) => (
        <div key={type} style={{ height: 32, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 5, background: index % 3 === 0 ? "var(--ata-blue-600)" : index % 3 === 1 ? "var(--ata-teal-500)" : "var(--ata-purple-500)" }} />
            {type}
          </span>
          <span style={{ color: "var(--ata-gray-500)" }}>{index + 3}</span>
        </div>
      ))}
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ata-gray-500)", margin: "24px 0 12px" }}>STATUS KEY</div>
      {["Proposed", "Scheduled", "In Progress", "Completed", "Cancelled", "Conflict"].map((status) => (
        <div key={status} style={{ height: 30, display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <span style={{ width: 16, height: 16, borderRadius: 6, border: status === "Proposed" ? "1px dashed var(--ata-blue-600)" : "1px solid var(--ata-gray-200)", background: status === "Cancelled" ? "var(--ata-danger-50)" : status === "In Progress" ? "var(--ata-success-50)" : "var(--ata-blue-50)" }} />
          {status}
        </div>
      ))}
    </aside>
  );
}

function Row({ name, index, provider = false }) {
  const show = index % 2 === 1 || provider;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px repeat(11, minmax(116px, 1fr))", height: 36, borderBottom: "1px solid var(--ata-gray-100)" }}>
      <div style={{ position: "sticky", left: 0, background: "#fff", borderRight: "1px solid var(--ata-gray-200)", padding: "0 12px", display: "flex", alignItems: "center", fontSize: 13, fontWeight: 600 }}>
        {name}
      </div>
      {timeCols.map((time, colIndex) => (
        <div key={time} style={{ borderRight: "1px solid var(--ata-gray-100)", padding: 4 }}>
          {show && colIndex === (index % 4) + 1 && (
            <SessionBlock
              title={provider ? clients[index % clients.length] : name}
              subtitle={provider ? "11am–5pm" : "Direct Therapy Home"}
              type={index % 5 === 0 ? "directTherapy" : provider && index % 4 === 0 ? "supervision" : "directTherapyHome"}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px repeat(11, minmax(116px, 1fr))", height: 34, background: "var(--ata-gray-50)", borderBottom: "1px solid var(--ata-gray-200)", borderTop: "1px solid var(--ata-gray-200)" }}>
      <div style={{ padding: "0 12px", display: "flex", alignItems: "center", fontSize: 13, fontWeight: 800, color: "var(--ata-gray-800)" }}>{title}</div>
    </div>
  );
}

export default function ScheduleDayView() {
  return (
    <AppShell activeNav="schedule">
      <div style={{ height: "100vh", overflow: "hidden", background: "#FFFFFF" }}>
        <ScheduleTopBar />
        <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", height: "calc(100vh - 72px)" }}>
          <FilterPanel />
          <main style={{ overflow: "auto", minWidth: 0 }}>
            <div style={{ minWidth: 1500 }}>
              <div style={{ display: "grid", gridTemplateColumns: "220px repeat(11, minmax(116px, 1fr))", height: 44, position: "sticky", top: 0, zIndex: 4, background: "#fff", borderBottom: "1px solid var(--ata-gray-200)" }}>
                <div style={{ padding: "0 12px", display: "flex", alignItems: "center", fontWeight: 700 }}>All day</div>
                {timeCols.map((time) => <div key={time} style={{ padding: "0 12px", display: "flex", alignItems: "center", color: "var(--ata-gray-500)", fontSize: 13, borderRight: "1px solid var(--ata-gray-100)" }}>{time}</div>)}
              </div>
              <SectionHeader title="CLIENTS (17)" />
              {clients.map((name, index) => <Row key={name} name={name} index={index} />)}
              <SectionHeader title="PROVIDERS (14)" />
              {providers.map((name, index) => <Row key={name} name={name} index={index} provider />)}
            </div>
          </main>
        </div>
        <FloatingActionDock actions={["Add session", "Analyze day", "Resolve conflicts", "Auto-complete"]} />
      </div>
    </AppShell>
  );
}
