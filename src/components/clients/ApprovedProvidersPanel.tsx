"use client";

import { useState } from "react";
import type { ApprovedHome, Provider, Position } from "@prisma/client";
import { assignApprovedHomeProvider, removeApprovedHomeProvider } from "@/lib/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserCog, X, Search } from "lucide-react";

interface SearchableProvider {
  id: string;
  firstName: string;
  lastName: string;
  position: Position;
  rbtLevel: string | null;
}

interface ApprovedProvidersPanelProps {
  clientId: string;
  approvedProviders: (ApprovedHome & { provider: Provider })[];
  allProviders: SearchableProvider[];
}

export function ApprovedProvidersPanel({
  clientId,
  approvedProviders: initial,
  allProviders,
}: ApprovedProvidersPanelProps) {
  const [approvedProviders, setApprovedProviders] = useState(initial);
  const [query, setQuery] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = approvedProviders.filter((a) => !a.endDate);
  const approvedIds = new Set(active.map((a) => a.providerId));

  // Filter all providers by search query, excluding already-approved ones
  const filtered = query.trim().length >= 1
    ? allProviders.filter((p) => {
        if (approvedIds.has(p.id)) return false;
        const name = `${p.firstName} ${p.lastName}`.toLowerCase();
        const reversed = `${p.lastName} ${p.firstName}`.toLowerCase();
        const q = query.toLowerCase();
        return name.includes(q) || reversed.includes(q) || p.position.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  function handleAdd(provider: SearchableProvider) {
    setError(null);
    setIsPending(true);
    assignApprovedHomeProvider(clientId, provider.id).then((result) => {
      setIsPending(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Reload to get full provider data from the server
      window.location.reload();
    }).catch(() => {
      setIsPending(false);
      setError("Failed to add provider.");
    });
  }

  function handleRemove(providerId: string) {
    setError(null);
    setIsPending(true);
    removeApprovedHomeProvider(clientId, providerId).then((result) => {
      setIsPending(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setApprovedProviders((prev) =>
        prev.map((a) =>
          a.providerId === providerId ? { ...a, endDate: new Date() } : a
        )
      );
    }).catch(() => {
      setIsPending(false);
      setError("Failed to remove provider.");
    });
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Approved Home Providers</h2>
        <span className="text-xs text-muted-foreground">{active.length} approved</span>
      </div>

      {error && <p className="text-sm text-destructive mb-3">{error}</p>}

      {active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center mb-4">
          <UserCog size={28} className="text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No providers approved yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border mb-4">
          {active.map(({ provider }) => (
            <li key={provider.id} className="py-2.5 first:pt-0 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {provider.firstName} {provider.lastName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {provider.position}{provider.rbtLevel ? ` · Level ${provider.rbtLevel}` : ""}
                </p>
              </div>
              <button
                onClick={() => handleRemove(provider.id)}
                disabled={isPending}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                title="Remove approval"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Search to add */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search providers by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 text-sm pl-8"
          disabled={isPending}
        />
      </div>

      {filtered.length > 0 && (
        <ul className="mt-1 border border-border rounded-md overflow-hidden divide-y divide-border">
          {filtered.map((p) => (
            <li key={p.id}>
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => handleAdd(p)}
                className="w-full justify-start h-auto py-2 px-3 rounded-none font-normal"
              >
                <div className="text-left">
                  <p className="text-sm font-medium">{p.firstName} {p.lastName}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.position}{p.rbtLevel ? ` · Level ${p.rbtLevel}` : ""}
                  </p>
                </div>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 1 && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          No matching providers found{approvedIds.size > 0 ? " (already-approved providers are hidden)" : ""}.
        </p>
      )}
    </div>
  );
}
