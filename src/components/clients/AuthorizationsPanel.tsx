"use client";

import Link from "next/link";
import type { Authorization } from "@prisma/client";
import { FileText, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AuthorizationsPanelProps {
  clientId: string;
  authorizations: Authorization[];
  usedHoursMap: Record<string, number>;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function getAuthStatus(auth: Authorization): { label: string; style: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(auth.endDate);
  const start = new Date(auth.startDate);

  if (end < today) return { label: "Expired", style: "bg-red-50 text-red-700 border-red-200" };
  if (start > today) return { label: "Pending", style: "bg-muted text-muted-foreground border-border" };

  const thirtyDays = new Date(today);
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  if (end <= thirtyDays) return { label: "Expiring Soon", style: "bg-amber-50 text-amber-700 border-amber-200" };

  return { label: "Active", style: "bg-green-50 text-green-700 border-green-200" };
}

export function AuthorizationsPanel({ clientId, authorizations, usedHoursMap }: AuthorizationsPanelProps) {
  const sorted = [...authorizations].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  );

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Authorizations</h2>
        <Link href={`/clients/${clientId}/authorizations/new`}>
          <Button size="sm" variant="outline" className="h-7 text-xs">
            <Plus size={12} className="mr-1" /> Add Auth
          </Button>
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText size={28} className="text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No authorizations on file.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {sorted.map((auth) => {
            const { label, style } = getAuthStatus(auth);
            const usedHours = usedHoursMap[auth.id] ?? 0;
            const approvedHours = auth.approvedHoursPerWeek;
            const isActive = label === "Active" || label === "Expiring Soon";
            const pct = isActive ? Math.min((usedHours / approvedHours) * 100, 100) : 0;
            const barColor = usedHours >= approvedHours
              ? "bg-red-500"
              : usedHours >= approvedHours * 0.8
              ? "bg-amber-400"
              : "bg-green-500";

            return (
              <div key={auth.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {auth.serviceCode ?? "All services"}
                      </span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs border ${style}`}>
                        {label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {auth.fundingSource && `${auth.fundingSource} · `}
                      {formatDate(auth.startDate)} – {formatDate(auth.endDate)}
                    </p>
                    {auth.authNumber && (
                      <p className="text-xs text-muted-foreground">Auth #{auth.authNumber}</p>
                    )}
                    {isActive && (
                      <div className="pt-1 space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>This week</span>
                          <span className={cn(usedHours >= approvedHours && "text-red-600 font-medium")}>
                            {usedHours.toFixed(1)} / {approvedHours}h
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all", barColor)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-semibold">{approvedHours}h/wk</p>
                      <p className="text-xs text-muted-foreground">authorized</p>
                    </div>
                    <Link href={`/clients/${clientId}/authorizations/${auth.id}/edit`}>
                      <Button variant="ghost" size="sm" aria-label="Edit authorization" title="Edit authorization" className="h-6 w-6 p-0">
                        <Pencil size={12} />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
