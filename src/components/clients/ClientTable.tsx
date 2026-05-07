"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Client } from "@prisma/client";
import { Badge, Chip, DataTable, FilterBar, SearchInput, type DataTableColumn } from "@/components/ui-ata";

interface ClientTableProps {
  clients: Client[];
  showAll: boolean;
}

type StatusInfo = {
  label: string;
  variant: "active" | "warning" | "danger" | "neutral";
};

function clientStatus(client: Client): StatusInfo {
  const now = new Date();
  if (client.terminationDate && client.terminationDate <= now) {
    return { label: "Discharged", variant: "danger" };
  }
  if (client.activeDate > now) {
    return { label: "Intake", variant: "warning" };
  }
  return { label: "Active", variant: "active" };
}

function formatDOB(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function ClientIdentity({ client }: { client: Client }) {
  const initials = `${client.firstName[0] ?? ""}${client.lastName[0] ?? ""}`.toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span className="ata-avatar" aria-hidden>
        {initials}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--ata-gray-900)", fontSize: 14 }}>
          {client.lastName}, {client.firstName}
        </div>
        <div style={{ fontSize: 12, color: "var(--ata-gray-500)" }}>#{client.id.slice(0, 8)}</div>
      </div>
    </div>
  );
}

export function ClientTable({ clients, showAll }: ClientTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      c.firstName.toLowerCase().includes(q) ||
      c.lastName.toLowerCase().includes(q) ||
      (c.insurance ?? "").toLowerCase().includes(q)
    );
  });

  const columns: DataTableColumn<Client>[] = [
    {
      key: "name",
      header: "Name",
      width: "28%",
      render: (row) => <ClientIdentity client={row} />,
    },
    {
      key: "dob",
      header: "Date of Birth",
      width: "16%",
      render: (row) => (
        <span style={{ color: "var(--ata-gray-600)" }}>{formatDOB(row.dateOfBirth)}</span>
      ),
    },
    {
      key: "insurance",
      header: "Insurance",
      width: "20%",
      render: (row) => row.insurance ?? <span style={{ color: "var(--ata-gray-400)" }}>—</span>,
    },
    {
      key: "preferences",
      header: "Preferences",
      width: "24%",
      render: (row) => {
        const tags: React.ReactNode[] = [];
        if (row.spanish) tags.push(<Chip key="es" color="blue">ES</Chip>);
        if (row.femaleProviderOnly) tags.push(<Chip key="f" color="purple">F only</Chip>);
        if (row.minimumRbtLevel)
          tags.push(<Chip key="lvl">Lvl {row.minimumRbtLevel}+</Chip>);
        return tags.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{tags}</div>
        ) : (
          <span style={{ color: "var(--ata-gray-400)" }}>—</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "12%",
      render: (row) => {
        const { label, variant } = clientStatus(row);
        return (
          <Badge variant={variant} dot>
            {label}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchInput
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerStyle={{ width: 360 }}
          shortcut="⌘K"
        />
        <button
          type="button"
          className="ata-btn ata-btn--ghost"
          onClick={() => router.push(showAll ? "/clients" : "/clients?status=all")}
        >
          {showAll ? "Active only" : "Show discharged"}
        </button>
        <span
          style={{
            marginLeft: "auto",
            color: "var(--ata-gray-500)",
            fontSize: 14,
          }}
        >
          {filtered.length} of {clients.length}
        </span>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/clients/${row.id}`)}
        emptyState={
          <span style={{ color: "var(--ata-gray-500)" }}>
            {search ? "No clients match your search." : "No clients found."}
          </span>
        }
      />
    </div>
  );
}
