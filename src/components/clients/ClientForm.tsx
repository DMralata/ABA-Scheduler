"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Client, ClientAvailability, DayOfWeek } from "@prisma/client";
import { createClient, updateClient, setClientAvailability } from "@/lib/actions/clients";
import type { ClientInput, UpdateClientInput } from "@/lib/schemas/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { ClientAvailabilityPanel } from "@/components/clients/ClientAvailabilityPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ClientFormProps {
  client?: Client;
  availability?: ClientAvailability[];
  centers?: { id: string; name: string }[];
}

const NEW_CLIENT_DAYS: { key: DayOfWeek; label: string }[] = [
  { key: "MONDAY", label: "Monday" },
  { key: "TUESDAY", label: "Tuesday" },
  { key: "WEDNESDAY", label: "Wednesday" },
  { key: "THURSDAY", label: "Thursday" },
  { key: "FRIDAY", label: "Friday" },
  { key: "SATURDAY", label: "Saturday" },
  { key: "SUNDAY", label: "Sunday" },
];

type NewAvailability = Partial<Record<DayOfWeek, { startTime: string; endTime: string }>>;

function toDateInput(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

export function ClientForm({ client, availability, centers }: ClientFormProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Availability entered at creation time (edit mode uses ClientAvailabilityPanel instead).
  const [newAvailability, setNewAvailability] = useState<NewAvailability>({});

  function toggleNewDay(day: DayOfWeek) {
    setNewAvailability((prev) => {
      const next = { ...prev };
      if (next[day]) delete next[day];
      else next[day] = { startTime: "08:00", endTime: "17:00" };
      return next;
    });
  }

  function setNewDayTime(day: DayOfWeek, field: "startTime" | "endTime", value: string) {
    setNewAvailability((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? { startTime: "", endTime: "" }), [field]: value },
    }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Validate availability windows entered at creation time
    if (!client) {
      for (const { key, label } of NEW_CLIENT_DAYS) {
        const w = newAvailability[key];
        if (!w) continue;
        if (!w.startTime || !w.endTime) {
          setError(`Availability for ${label} needs both a start and end time.`);
          return;
        }
        if (w.startTime >= w.endTime) {
          setError(`Availability for ${label}: end time must be after start time.`);
          return;
        }
      }
    }

    const fd = new FormData(e.currentTarget);

    const data = {
      preferredLocation: (fd.get("preferredLocation") as "HOME" | "CENTER" | "HYBRID" | "SCHOOL") || "CENTER",
      externalId: fd.get("externalId") as string,
      firstName: fd.get("firstName") as string,
      lastName: fd.get("lastName") as string,
      dateOfBirth: fd.get("dateOfBirth") as string,
      gender: fd.get("gender") as string,
      spanish: fd.get("spanish") === "yes",
      femaleProviderOnly: fd.get("femaleProviderOnly") === "yes",
      minimumRbtLevel: (() => { const v = fd.get("minimumRbtLevel") as string; return v && v !== "none" ? v : undefined; })(),
      activeDate: fd.get("activeDate") as string,
      terminationDate: (fd.get("terminationDate") as string) || undefined,
      centerId: (() => { const v = fd.get("centerId") as string; return v && v !== "none" ? v : undefined; })(),
      insurance: fd.get("insurance") as string,
      street: (fd.get("street") as string) || undefined,
      city: (fd.get("city") as string) || undefined,
      state: (fd.get("state") as string) || undefined,
      zip: (fd.get("zip") as string) || undefined,
      latitude: (() => { const v = fd.get("latitude") as string; const n = parseFloat(v); return !isNaN(n) ? n : undefined; })(),
      longitude: (() => { const v = fd.get("longitude") as string; const n = parseFloat(v); return !isNaN(n) ? n : undefined; })(),
      defaultSessionHours: (() => {
        const v = fd.get("defaultSessionHours") as string;
        const n = parseFloat(v);
        return !isNaN(n) && n > 0 ? n : undefined;
      })(),
    };

    setIsPending(true);
    const action = client
      ? updateClient(client.id, data as unknown as UpdateClientInput)
      : createClient(data as unknown as ClientInput);

    action
      .then(async (result) => {
        if (!result.success) {
          setError(result.error);
          setIsPending(false);
          return;
        }
        // Save availability windows entered on the create form so the client
        // is schedulable immediately - no second trip through Edit needed.
        if (!client) {
          const entries = Object.entries(newAvailability) as [DayOfWeek, { startTime: string; endTime: string }][];
          for (const [day, w] of entries) {
            const availResult = await setClientAvailability(result.data.id, day, [w]);
            if (!availResult.success) {
              // Client was created - send the user to the record with a clear message
              // rather than leaving them stuck on the form.
              router.push(`/clients/${result.data.id}?availabilityError=1`);
              router.refresh();
              return;
            }
          }
        }
        router.push(`/clients/${result.data.id}`);
        router.refresh();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        setIsPending(false);
      });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Row 1: Identity | Scheduling Rules */}
      <div className="grid grid-cols-2 gap-6">
        {/* Identity */}
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h2 className="text-sm font-semibold">Identity</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" name="firstName" defaultValue={client?.firstName} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" name="lastName" defaultValue={client?.lastName} required />
            </div>
          </div>
          {!client && (
            <div className="space-y-1.5">
              <Label htmlFor="externalId">External ID (EMR)</Label>
              <Input id="externalId" name="externalId" required />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                defaultValue={toDateInput(client?.dateOfBirth)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gender">Gender</Label>
              <Select name="gender" defaultValue={client?.gender ?? ""} required>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="spanish">Requires Spanish</Label>
              <Select name="spanish" defaultValue={client?.spanish ? "yes" : "no"}>
                <SelectTrigger id="spanish"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="femaleProviderOnly">Female Provider Only</Label>
              <Select name="femaleProviderOnly" defaultValue={client?.femaleProviderOnly ? "yes" : "no"}>
                <SelectTrigger id="femaleProviderOnly"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Scheduling Rules */}
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h2 className="text-sm font-semibold">Scheduling Rules</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="preferredLocation">Preferred Location</Label>
              <Select name="preferredLocation" defaultValue={client?.preferredLocation ?? "CENTER"}>
                <SelectTrigger id="preferredLocation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CENTER">Center</SelectItem>
                  <SelectItem value="HOME">Home</SelectItem>
                  <SelectItem value="HYBRID">Hybrid</SelectItem>
                  <SelectItem value="SCHOOL">School</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Home sessions use the approved provider list.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minimumRbtLevel">Minimum RBT Level</Label>
              <Select name="minimumRbtLevel" defaultValue={client?.minimumRbtLevel ?? "none"}>
                <SelectTrigger id="minimumRbtLevel"><SelectValue placeholder="No minimum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No minimum</SelectItem>
                  <SelectItem value="I">Level I or higher</SelectItem>
                  <SelectItem value="II">Level II or higher</SelectItem>
                  <SelectItem value="III">Level III only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {centers && centers.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="centerId">Center</Label>
                <Select name="centerId" defaultValue={client?.centerId ?? "none"}>
                  <SelectTrigger id="centerId"><SelectValue placeholder="No center" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No center</SelectItem>
                    {centers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Sets the timezone and drive-time origin for scheduling.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="defaultSessionHours">Session Length (hours)</Label>
              <Input
                id="defaultSessionHours"
                name="defaultSessionHours"
                type="number"
                min="2"
                max="8"
                step="0.5"
                placeholder="Center default (4h)"
                defaultValue={client?.defaultSessionHours ?? ""}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the center default.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Insurance & Dates | Address */}
      <div className="grid grid-cols-2 gap-6">
        {/* Insurance & Dates */}
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h2 className="text-sm font-semibold">Insurance & Dates</h2>
          <div className="space-y-1.5">
            <Label htmlFor="insurance">Insurance / Funding Source</Label>
            <Input id="insurance" name="insurance" defaultValue={client?.insurance} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="activeDate">Active Date</Label>
              <Input
                id="activeDate"
                name="activeDate"
                type="date"
                defaultValue={toDateInput(client?.activeDate)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="terminationDate">Termination Date</Label>
              <Input
                id="terminationDate"
                name="terminationDate"
                type="date"
                defaultValue={toDateInput(client?.terminationDate)}
              />
              <p className="text-xs text-muted-foreground">Leave blank for active clients.</p>
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h2 className="text-sm font-semibold">Address</h2>
          <AddressAutocomplete
            defaultStreet={client?.street}
            defaultCity={client?.city}
            defaultState={client?.state}
            defaultZip={client?.zip}
            defaultLatitude={client?.latitude}
            defaultLongitude={client?.longitude}
          />
        </div>
      </div>

      {/* Availability — full width, only when editing */}
      {client && availability && (
        <ClientAvailabilityPanel
          clientId={client.id}
          availability={availability}
        />
      )}

      {/* Availability at creation — without windows the client cannot be scheduled */}
      {!client && (
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Availability</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Check the days this client can attend. Without availability, the scheduler
              can&apos;t book or propose sessions for them.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            {NEW_CLIENT_DAYS.map(({ key, label }) => {
              const w = newAvailability[key];
              return (
                <div key={key} className="flex items-center gap-3 h-9">
                  <label className="flex items-center gap-2 w-28 shrink-0 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!w}
                      onChange={() => toggleNewDay(key)}
                      className="h-4 w-4 rounded border-input"
                    />
                    {label}
                  </label>
                  {w && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={w.startTime}
                        onChange={(e) => setNewDayTime(key, "startTime", e.target.value)}
                        className="h-8 w-28"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={w.endTime}
                        onChange={(e) => setNewDayTime(key, "endTime", e.target.value)}
                        className="h-8 w-28"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : client ? "Save Changes" : "Add Client"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
