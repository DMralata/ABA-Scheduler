import React from "react";
import { Download, Plus } from "lucide-react";
import { AppShell } from "../../components/app/AppShell";
import { Button } from "../../components/ui/Button";
import { SearchInput } from "../../components/ui/SearchInput";
import { FilterBar, SelectButton } from "../../components/ui/FilterBar";
import { DataTable } from "../../components/ui/DataTable";
import { Badge } from "../../components/ui/Badge";
import { Chip } from "../../components/ui/Chip";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { clients } from "../../data/sampleData";

function ClientIdentity({ row }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span className="ata-avatar" style={{ background: "var(--ata-blue-600)" }}>{row.initials}</span>
      <div>
        <div style={{ fontWeight: 700, color: "var(--ata-gray-900)" }}>{row.name}</div>
        <div style={{ fontSize: 12, color: "var(--ata-gray-500)" }}>#{row.id}</div>
      </div>
    </div>
  );
}

const columns = [
  { key: "name", header: "Name", width: "25%", render: (row) => <ClientIdentity row={row} /> },
  { key: "age", header: "Age", width: "14%", render: (row) => row.ageDob },
  { key: "insurance", header: "Insurance", width: "18%", render: (row) => row.insurance },
  {
    key: "auth",
    header: "Auth Used",
    width: "18%",
    render: (row) => <ProgressBar value={row.authUsed} max={row.authTotal} showLabel />,
  },
  {
    key: "preferences",
    header: "Preferences",
    width: "18%",
    render: (row) =>
      row.preferences.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {row.preferences.map((item) => (
            <Chip key={item} color={item === "Spanish" ? "blue" : "purple"}>{item}</Chip>
          ))}
        </div>
      ) : (
        <span style={{ color: "var(--ata-gray-400)" }}>—</span>
      ),
  },
  { key: "status", header: "Status", width: "7%", render: (row) => <Badge variant="active" dot>{row.status}</Badge> },
];

export default function ClientsListPage() {
  return (
    <AppShell activeNav="clients" sidebarVariant="compact">
      <div className="ata-page">
        <header className="ata-page-header">
          <div>
            <h1 className="ata-page-title">Clients</h1>
            <p className="ata-page-subtitle">17 active · 3 unstaffed · 71h/wk authorized</p>
          </div>
          <div className="ata-header-actions">
            <Button variant="secondary" iconLeft={<Download size={16} />}>Export</Button>
            <Button iconLeft={<Plus size={16} />}>Add client</Button>
          </div>
        </header>

        <FilterBar>
          <SearchInput placeholder="Search clients..." shortcut="⌘K" style={{ width: 360 }} />
          <SelectButton label="All insurances" />
          <SelectButton label="Any preference" />
          <SelectButton label="Active" />
          <div style={{ marginLeft: "auto", color: "var(--ata-gray-500)", fontSize: 14 }}>Sort: Name ↑</div>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={clients}
          selectedRowId="C-004"
          footer={
            <>
              <span style={{ fontSize: 14, color: "var(--ata-gray-600)" }}>Showing 1 to 11 of 17 clients</span>
              <span style={{ fontSize: 14, color: "var(--ata-gray-600)" }}>12 per page</span>
            </>
          }
        />
      </div>
    </AppShell>
  );
}
