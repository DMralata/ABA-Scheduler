"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Provider, SessionType, RecurringEvent, RecurrenceFrequency, DayOfWeek } from "@prisma/client";
import { createRecurringEvent, updateRecurringEvent, getAvailableDays } from "@/lib/actions/recurring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DAYS: { value: DayOfWeek; label: string; short: string }[] = [
  { value: "MONDAY",    label: "Monday",    short: "Mon" },
  { value: "TUESDAY",   label: "Tuesday",   short: "Tue" },
  { value: "WEDNESDAY", label: "Wednesday", short: "Wed" },
  { value: "THURSDAY",  label: "Thursday",  short: "Thu" },
  { value: "FRIDAY",    label: "Friday",    short: "Fri" },
  { value: "SATURDAY",  label: "Saturday",  short: "Sat" },
  { value: "SUNDAY",    label: "Sunday",    short: "Sun" },
];

type RecurringEventWithProviders = RecurringEvent & {
  providers: { providerId: string }[];
};

interface Props {
  sessionTypes: Pick<SessionType, "id" | "name">[];
  providers: Pick<Provider, "id" | "firstName" | "lastName" | "position">[];
  centerId: string;
  timezone: string;
  event?: RecurringEventWithProviders;
}

export function RecurringEventForm({ sessionTypes, providers, centerId, timezone, event }: Props) {
  const router = useRouter();
  const isEdit = !!event;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availDaysLoading, setAvailDaysLoading] = useState(false);
  const [availDaysError, setAvailDaysError] = useState<string | null>(null);

  const [startTime, setStartTime] = useState(event?.startTime ?? "12:00");
  const [endTime, setEndTime] = useState(event?.endTime ?? "13:00");

  const [frequency, setFrequency] = useState<RecurrenceFrequency>(event?.frequency ?? "WEEKLY");
  const [daysOfWeek, setDaysOfWeek] = useState<DayOfWeek[]>(
    (event?.daysOfWeek as DayOfWeek[]) ?? ["MONDAY"]
  );
  const [sessionTypeId, setSessionTypeId] = useState(event?.sessionTypeId ?? "");
  const [billable, setBillable] = useState(event?.billable ?? false);
  const [selectedProviders, setSelectedProviders] = useState<string[]>(
    event?.providers.map((p) => p.providerId) ?? []
  );

  function toggleDay(day: DayOfWeek) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function toggleProvider(id: string) {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  function selectAllProviders() {
    setSelectedProviders(providers.map((p) => p.id));
  }

  function handleAssignToAvailableDays() {
    setAvailDaysError(null);
    setAvailDaysLoading(true);
    getAvailableDays(selectedProviders, startTime, endTime)
      .then((result) => {
        if (!result.success) {
          setAvailDaysError(result.error);
        } else {
          setDaysOfWeek(result.data.days);
        }
      })
      .catch(() => setAvailDaysError("Failed to check availability."))
      .finally(() => setAvailDaysLoading(false));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const startDateStr = fd.get("startDate") as string;
    const endDateStr = fd.get("endDate") as string;

    const input = {
      name: (fd.get("name") as string).trim(),
      sessionTypeId,
      centerId,
      frequency,
      daysOfWeek,
      dayOfMonth: frequency === "MONTHLY" ? parseInt(fd.get("dayOfMonth") as string, 10) || 1 : undefined,
      startTime: fd.get("startTime") as string,
      endTime: fd.get("endTime") as string,
      timezone,
      startDate: new Date(startDateStr + "T00:00:00Z"),
      endDate: endDateStr ? new Date(endDateStr + "T00:00:00Z") : undefined,
      billable,
      notes: (fd.get("notes") as string) || undefined,
      providerIds: selectedProviders,
    };

    setLoading(true);
    try {
      const result = isEdit
        ? await updateRecurringEvent(event.id, input)
        : await createRecurringEvent(input);

      if (!result.success) {
        setError(result.error);
      } else {
        router.push("/recurring");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="name">Event Name</Label>
        <Input id="name" name="name" defaultValue={event?.name ?? ""} placeholder="e.g. Lunch Break" required />
      </div>

      {/* Session Type */}
      <div className="space-y-1.5">
        <Label>Session Type</Label>
        <Select value={sessionTypeId} onValueChange={(v) => { if (v) setSessionTypeId(v); }}>
          <SelectTrigger>
            <SelectValue placeholder="Select session type" />
          </SelectTrigger>
          <SelectContent>
            {sessionTypes.map((st) => (
              <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Frequency */}
      <div className="space-y-1.5">
        <Label>Frequency</Label>
        <Select value={frequency} onValueChange={(v) => setFrequency(v as RecurrenceFrequency)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DAILY">Daily</SelectItem>
            <SelectItem value="WEEKLY">Weekly</SelectItem>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Days of Week (weekly only) */}
      {frequency === "WEEKLY" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label>Days of Week</Label>
            <button
              type="button"
              onClick={handleAssignToAvailableDays}
              disabled={availDaysLoading}
              className="text-xs text-primary underline hover:text-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {availDaysLoading ? "Checking availability…" : "Assign to Available Days"}
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map(({ value, short }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleDay(value)}
                className={cn(
                  "w-11 h-9 rounded-md text-sm font-medium border transition-colors",
                  daysOfWeek.includes(value)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:border-primary/50"
                )}
              >
                {short}
              </button>
            ))}
          </div>
          {availDaysError && (
            <p className="text-xs text-destructive">{availDaysError}</p>
          )}
        </div>
      )}

      {/* Day of Month (monthly only) */}
      {frequency === "MONTHLY" && (
        <div className="space-y-1.5">
          <Label htmlFor="dayOfMonth">Day of Month</Label>
          <Input
            id="dayOfMonth"
            name="dayOfMonth"
            type="number"
            min={1}
            max={28}
            defaultValue={event?.dayOfMonth ?? 1}
            className="w-24"
          />
          <p className="text-xs text-muted-foreground">Use 1–28 to avoid month-end gaps.</p>
        </div>
      )}

      {/* Time Range */}
      <div className="flex gap-4">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="startTime">Start Time</Label>
          <Input id="startTime" name="startTime" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="endTime">End Time</Label>
          <Input id="endTime" name="endTime" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </div>
      </div>

      {/* Date Range */}
      <div className="flex gap-4">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={event ? event.startDate.toISOString().slice(0, 10) : todayStr}
            required
          />
        </div>
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="endDate">End Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={event?.endDate ? event.endDate.toISOString().slice(0, 10) : ""}
          />
          <p className="text-xs text-muted-foreground">Leave blank to generate 90 days ahead.</p>
        </div>
      </div>

      {/* Billable */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="billable"
          checked={billable}
          onChange={(e) => setBillable(e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
        />
        <Label htmlFor="billable" className="font-normal cursor-pointer">Billable</Label>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={event?.notes ?? ""}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          placeholder="Any notes about this recurring event…"
        />
      </div>

      {/* Providers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Providers</Label>
          <button
            type="button"
            onClick={selectAllProviders}
            className="text-xs text-primary underline hover:text-primary/80 transition-colors"
          >
            Select all
          </button>
        </div>
        <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
          {providers.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedProviders.includes(p.id)}
                onChange={() => toggleProvider(p.id)}
                className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
              />
              <span className="text-sm">
                {p.lastName}, {p.firstName}
                <span className="ml-2 text-xs text-muted-foreground">{p.position}</span>
              </span>
            </label>
          ))}
        </div>
        {selectedProviders.length > 0 && (
          <p className="text-xs text-muted-foreground">{selectedProviders.length} provider{selectedProviders.length !== 1 ? "s" : ""} selected</p>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : isEdit ? "Save Changes" : "Create Recurring Event"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
