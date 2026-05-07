"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@prisma/client";
import { createProvider, updateProvider } from "@/lib/actions/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderFormProps {
  provider?: Provider; // undefined = create mode
}

export function ProviderForm({ provider }: ProviderFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [position, setPosition] = useState(provider?.position ?? "RBT");
  const [rbtLevel, setRbtLevel] = useState(provider?.rbtLevel ?? "");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const data = {
      externalId: fd.get("externalId") as string,
      firstName: fd.get("firstName") as string,
      lastName: fd.get("lastName") as string,
      position: position as "BCBA" | "BCaBA" | "RBT",
      rbtLevel: rbtLevel ? (rbtLevel as "I" | "II" | "III") : undefined,
      gender: fd.get("gender") as string,
      spanish: fd.get("spanish") === "yes",
      centerId: (fd.get("centerId") as string) || undefined,
      street: (fd.get("street") as string) || undefined,
      city: (fd.get("city") as string) || undefined,
      state: (fd.get("state") as string) || undefined,
      zip: (fd.get("zip") as string) || undefined,
      latitude: (() => { const v = fd.get("latitude") as string; const n = parseFloat(v); return !isNaN(n) ? n : undefined; })(),
      longitude: (() => { const v = fd.get("longitude") as string; const n = parseFloat(v); return !isNaN(n) ? n : undefined; })(),
      payRateHourly: fd.get("payRateHourly")
        ? parseFloat(fd.get("payRateHourly") as string)
        : undefined,
      zoomUserId: (fd.get("zoomUserId") as string) || undefined,
    };

    startTransition(async () => {
      const result = provider
        ? await updateProvider(provider.id, data)
        : await createProvider(data);

      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push(`/providers/${result.data.id}`);
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

      {/* Identity */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold">Identity</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First Name</Label>
            <Input id="firstName" name="firstName" defaultValue={provider?.firstName} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last Name</Label>
            <Input id="lastName" name="lastName" defaultValue={provider?.lastName} required />
          </div>
        </div>
        {!provider && (
          <div className="space-y-1.5">
            <Label htmlFor="externalId">External ID (EMR)</Label>
            <Input id="externalId" name="externalId" required />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="gender">Gender</Label>
            <Select name="gender" defaultValue={provider?.gender ?? ""} required>
              <SelectTrigger id="gender">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Male">Male</SelectItem>
                <SelectItem value="Female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spanish">Spanish Speaking</Label>
            <Select name="spanish" defaultValue={provider?.spanish ? "yes" : "no"}>
              <SelectTrigger id="spanish">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Role */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold">Role & Credentials</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Position</Label>
            <Select value={position} onValueChange={(v) => { if (v) setPosition(v as "BCBA" | "BCaBA" | "RBT"); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BCBA">BCBA</SelectItem>
                <SelectItem value="BCaBA">BCaBA</SelectItem>
                <SelectItem value="RBT">RBT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {position === "RBT" && (
            <div className="space-y-1.5">
              <Label>RBT Level</Label>
              <Select value={rbtLevel} onValueChange={(v) => { if (v !== null) setRbtLevel(v); }} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select level…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="I">Level I</SelectItem>
                  <SelectItem value="II">Level II</SelectItem>
                  <SelectItem value="III">Level III</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payRateHourly">Hourly Pay Rate ($)</Label>
          <Input
            id="payRateHourly"
            name="payRateHourly"
            type="number"
            step="0.01"
            min="0"
            defaultValue={provider?.payRateHourly ?? ""}
            placeholder="e.g. 22.50"
          />
        </div>
      </div>

      {/* Address */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold">Address</h2>
        <AddressAutocomplete
          defaultStreet={provider?.street}
          defaultCity={provider?.city}
          defaultState={provider?.state}
          defaultZip={provider?.zip}
          defaultLatitude={provider?.latitude}
          defaultLongitude={provider?.longitude}
        />
      </div>

      {/* Integrations */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold">Integrations</h2>
        <div className="space-y-1.5">
          <Label htmlFor="zoomUserId">Zoom User ID</Label>
          <Input
            id="zoomUserId"
            name="zoomUserId"
            defaultValue={provider?.zoomUserId ?? ""}
            placeholder="e.g. abc123XYZ"
          />
          <p className="text-xs text-muted-foreground">
            Link this provider to their Zoom account so they can message the scheduler bot to cancel sessions.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : provider ? "Save Changes" : "Add Provider"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
