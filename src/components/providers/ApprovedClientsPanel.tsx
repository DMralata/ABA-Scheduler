"use client";

import type { ApprovedHome, Client } from "@prisma/client";
import { Users } from "lucide-react";

interface ApprovedClientsPanelProps {
  providerId: string;
  approvedClients: (ApprovedHome & { client: Client })[];
}

export function ApprovedClientsPanel({ approvedClients }: ApprovedClientsPanelProps) {
  const active = approvedClients.filter((a) => !a.endDate);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Approved Clients</h2>
        <span className="text-xs text-muted-foreground">{active.length} client{active.length !== 1 ? "s" : ""}</span>
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Users size={28} className="text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No clients approved yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Approve this provider from a client's profile page.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {active.map(({ client }) => (
            <li key={client.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {client.firstName} {client.lastName}
                </p>
                <p className="text-xs text-muted-foreground capitalize">{client.insurance}</p>
              </div>
              <a
                href={`/clients/${client.id}`}
                className="text-xs text-primary hover:underline"
              >
                View →
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
