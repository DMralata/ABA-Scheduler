import React from "react";
import { Plus } from "lucide-react";
import { AppShell } from "../../components/app/AppShell";
import { Button } from "../../components/ui/Button";
import { SearchInput } from "../../components/ui/SearchInput";
import { FilterBar, SelectButton } from "../../components/ui/FilterBar";
import { DataTable } from "../../components/ui/DataTable";
import { Badge } from "../../components/ui/Badge";
import { Chip } from "../../components/ui/Chip";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { providers } from "../../data/sampleData";

const columns = [
  {
    key: "provider",
    header: "Provider",
    width: "24%",
    render: (row) => (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="ata-avatar">{row.initials}</span>
        <div>
          <div style={{ fontWeight: 700, color: "var(--ata-gray-900)" }}>{row.name}</div>
          <div style={{ fontSize: 12, color: "var(--ata-gray-500)" }}>#{row.id}</div>
        </div>
      </div>
    ),
  },
  { key: "position", header: "Position", width: "10%", render: (row) => row.position },
  { key: "level", header: "Level", width: "12%", render: (row) => row.level },
  {
    key: "languages",
    header: "Languages",
    width: "12%",
    render: (row) => (
      <div style={{ display: "flex", gap: 6 }}>
        {row.languages.map((lang) => <Chip key={lang} color={lang === "ES" ? "blue" : "default"}>{lang}</Chip>)}
      </div>
    ),
  },
  { key: "availability", header: "Weekly Availability", width: "20%", render: (row) => row.availability },
  { key: "utilization", header: "Utilization", width: "14%", render: (row) => <ProgressBar value={row.utilization} max={100} showLabel /> },
  { key: "status", header: "Status", width: "8%", render: (row) => <Badge variant="active" dot>{row.status}</Badge> },
];

function Metric({ value, label, sub }) {
  return (
    <div className="ata-card" style={{ padding: 16, minHeight: 92 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--ata-gray-900)" }}>{value}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--ata-gray-500)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export default function ProvidersListPage() {
  return (
    <AppShell activeNav="providers" sidebarVariant="compact">
      <div className="ata-page">
        <header className="ata-page-header">
          <div>
            <h1 className="ata-page-title">Providers</h1>
            <p className="ata-page-subtitle">14 active providers</p>
          </div>
          <Button iconLeft={<Plus size={16} />}>Add Provider</Button>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 18 }}>
          <Metric value="14" label="Active providers" sub="100% of providers" />
          <Metric value="6" label="Bilingual providers" sub="43% speak 2+ languages" />
          <Metric value="4" label="BCBAs" sub="29% of providers" />
          <Metric value="8" label="Open availability today" sub="For new sessions" />
          <Metric value="3" label="Credentials expiring soon" sub="Within 60 days" />
        </div>

        <FilterBar>
          <SearchInput placeholder="Search providers..." shortcut="⌘K" style={{ width: 340 }} />
          <SelectButton label="Position" />
          <SelectButton label="Level" />
          <SelectButton label="Language" />
          <SelectButton label="Availability" />
          <SelectButton label="Status" />
          <div style={{ marginLeft: "auto", color: "var(--ata-gray-600)", fontSize: 14 }}>Show inactive</div>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={providers}
          footer={
            <>
              <span style={{ fontSize: 14, color: "var(--ata-gray-600)" }}>Showing 1 to 8 of 14 providers</span>
              <span style={{ fontSize: 14, color: "var(--ata-gray-600)" }}>12 per page</span>
            </>
          }
        />
      </div>
    </AppShell>
  );
}
