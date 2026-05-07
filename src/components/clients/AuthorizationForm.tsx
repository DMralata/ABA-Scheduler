"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Authorization } from "@prisma/client";
import { createAuthorization, updateAuthorization } from "@/lib/actions/authorizations";
import type { AuthorizationInput, UpdateAuthorizationInput } from "@/lib/schemas/authorization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthorizationFormProps {
  clientId: string;
  authorization?: Authorization;
}

function toDateInput(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

export function AuthorizationForm({ clientId, authorization }: AuthorizationFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const hoursRaw = fd.get("approvedHoursPerWeek") as string;

    const data = {
      clientId,
      authNumber: (fd.get("authNumber") as string) || undefined,
      serviceCode: (fd.get("serviceCode") as string) || undefined,
      fundingSource: (fd.get("fundingSource") as string) || undefined,
      approvedHoursPerWeek: parseFloat(hoursRaw),
      startDate: fd.get("startDate") as string,
      endDate: fd.get("endDate") as string,
      notes: (fd.get("notes") as string) || undefined,
    };

    startTransition(async () => {
      const result = authorization
        ? await updateAuthorization(authorization.id, data as unknown as UpdateAuthorizationInput)
        : await createAuthorization(data as unknown as AuthorizationInput);

      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push(`/clients/${clientId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold">Authorization Details</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="authNumber">Auth Number</Label>
            <Input
              id="authNumber"
              name="authNumber"
              defaultValue={authorization?.authNumber ?? ""}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="serviceCode">Service Code (CPT)</Label>
            <Input
              id="serviceCode"
              name="serviceCode"
              defaultValue={authorization?.serviceCode ?? ""}
              placeholder="Leave blank for all services"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fundingSource">Funding Source / Insurance</Label>
          <Input
            id="fundingSource"
            name="fundingSource"
            defaultValue={authorization?.fundingSource ?? ""}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="approvedHoursPerWeek">Approved Hours / Week</Label>
          <Input
            id="approvedHoursPerWeek"
            name="approvedHoursPerWeek"
            type="number"
            min="0.5"
            step="0.5"
            defaultValue={authorization?.approvedHoursPerWeek ?? ""}
            required
          />
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold">Date Range</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={toDateInput(authorization?.startDate)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={toDateInput(authorization?.endDate)}
              required
            />
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold">Notes</h2>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={authorization?.notes ?? ""}
            placeholder="Optional internal notes"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : authorization ? "Save Changes" : "Add Authorization"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
