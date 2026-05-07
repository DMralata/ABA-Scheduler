"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Provider } from "@prisma/client";
import { Badge, Chip, DataTable, FilterBar, SearchInput, type DataTableColumn } from "@/components/ui-ata";

interface ProviderTableProps {
  providers: Provider[];
  showAll: boolean;
}

const POSITION_LABEL: Record<string, string> = {
  BCBA: "BCBA",
  BCaBA: "BCaBA",
  RBT: "RBT",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ON_LEAVE: "On Leave",
};

const STATUS_VARIANT: Record<string, "active" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "active",
  INACTIVE: "danger",
  ON_LEAVE: "warning",
};

function ProviderIdentity({ provider }: { provider: Provider }) {
  const initials = `${provider.firstName[0] ?? ""}${provider.lastName[0] ?? ""}`.toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span className="ata-avatar" aria-hidden>
        {initials}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--ata-gray-900)", fontSize: 14 }}>
          {provider.lastName}, {provider.firstName}
        </div>
        <div style={{ fontSize: 12, color: "var(--ata-gray-500)" }}>
          #{provider.id.slice(0, 8)}
        </div>
      </div>
    </div>
  );
}

export function ProviderTable({ providers, showAll }: ProviderTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = providers.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.position.toLowerCase().includes(q)
    );
  });

  const columns: DataTableColumn<Provider>[] = [
    {
      key: "name",
      header: "Name",
      width: "30%",
      render: (row) => <ProviderIdentity provider={row} />,
    },
    {
      key: "position",
      header: "Position",
      width: "16%",
      render: (row) => <Chip color="blue">{POSITION_LABEL[row.position] ?? row.position}</Chip>,
    },
    {
      key: "level",
      header: "Level",
      width: "16%",
      render: (row) =>
        row.rbtLevel ? (
          `Level ${row.rbtLevel}`
        ) : (
          <span style={{ color: "var(--ata-gray-400)" }}>—</span>
        ),
    },
    {
      key: "languages",
      header: "Languages",
      width: "20%",
      render: (row) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Chip>EN</Chip>
          {row.spanish && <Chip color="blue">ES</Chip>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "18%",
      render: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? "neutral"} dot>
          {STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchInput
          placeholder="Search providers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerStyle={{ width: 360 }}
          shortcut="⌘K"
        />
        <button
          type="button"
          className="ata-btn ata-btn--ghost"
          onClick={() =>
            router.push(showAll ? "/providers" : "/providers?status=all")
          }
        >
          {showAll ? "Active only" : "Show inactive"}
        </button>
        <span style={{ marginLeft: "auto", color: "var(--ata-gray-500)", fontSize: 14 }}>
          {filtered.length} of {providers.length}
        </span>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/providers/${row.id}`)}
        emptyState={
          <span style={{ color: "var(--ata-gray-500)" }}>
            {search ? "No providers match your search." : "No providers found."}
          </span>
        }
      />
    </div>
  );
}
