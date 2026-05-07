"use client";

import { useState } from "react";
import type { ClientPreferredSlot, DayOfWeek } from "@prisma/client";
import { saveClientPreferredSlots } from "@/lib/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

const DAYS: DayOfWeek[] = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu",
  FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun",
};

const DAY_ORDER: Record<DayOfWeek, number> = {
  MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3,
  FRIDAY: 4, SATURDAY: 5, SUNDAY: 6,
};

interface ClientPreferredSlotsPanelProps {
  clientId: string;
  preferredSlots: ClientPreferredSlot[];
}

export function ClientPreferredSlotsPanel({
  clientId,
  preferredSlots: initialSlots,
}: ClientPreferredSlotsPanelProps) {
  const [slots, setSlots] = useState(
    [...initialSlots].sort((a, b) => {
      const dayDiff = DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek];
      return dayDiff !== 0 ? dayDiff : a.startTime.localeCompare(b.startTime);
    })
  );
  const [adding, setAdding] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<DayOfWeek>>(new Set());
  const [draftTime, setDraftTime] = useState("09:00");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(day: DayOfWeek) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  }

  function save(nextSlots: { dayOfWeek: DayOfWeek; startTime: string }[]) {
    setIsPending(true);
    setError(null);
    saveClientPreferredSlots(clientId, nextSlots)
      .then((result) => {
        setIsPending(false);
        if (!result.success) { setError(result.error); return; }
        const sorted = [...nextSlots]
          .sort((a, b) => {
            const d = DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek];
            return d !== 0 ? d : a.startTime.localeCompare(b.startTime);
          })
          .map((s, i) => ({ ...s, id: `local-${i}`, clientId, createdAt: new Date() }));
        setSlots(sorted);
      })
      .catch(() => { setIsPending(false); setError("Failed to save."); });
  }

  function handleAdd() {
    if (selectedDays.size === 0) { setError("Select at least one day."); return; }
    const existing = new Set(slots.map((s) => `${s.dayOfWeek}|${s.startTime}`));
    const newEntries = [...selectedDays]
      .filter((d) => !existing.has(`${d}|${draftTime}`))
      .map((d) => ({ dayOfWeek: d, startTime: draftTime }));
    const next = [
      ...slots.map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime })),
      ...newEntries,
    ];
    save(next);
    setAdding(false);
    setSelectedDays(new Set());
    setDraftTime("09:00");
  }

  function handleRemove(dayOfWeek: DayOfWeek, startTime: string) {
    const next = slots
      .filter((s) => !(s.dayOfWeek === dayOfWeek && s.startTime === startTime))
      .map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime }));
    save(next);
  }

  // Group slots by start time for display
  const byTime = new Map<string, DayOfWeek[]>();
  for (const s of slots) {
    if (!byTime.has(s.startTime)) byTime.set(s.startTime, []);
    byTime.get(s.startTime)!.push(s.dayOfWeek);
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Preferred Schedule</h2>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(null); }}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Plus size={12} /> Add slot
          </button>
        )}
      </div>

      {error && <p className="text-xs text-destructive mb-3">{error}</p>}

      {slots.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No preferred slots set.</p>
      )}

      {/* Grouped display */}
      <div className="space-y-2">
        {[...byTime.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([time, days]) => (
          <div key={time} className="flex items-center gap-2 group">
            <span className="text-sm font-medium w-14 shrink-0">{time}</span>
            <div className="flex flex-wrap gap-1 flex-1">
              {[...days].sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b]).map((day) => (
                <span
                  key={day}
                  className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full"
                >
                  {DAY_SHORT[day]}
                  <button
                    onClick={() => handleRemove(day, time)}
                    disabled={isPending}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {adding && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Days</p>
            <div className="flex gap-1 flex-wrap">
              {DAYS.map((day) => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    selectedDays.has(day)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary"
                  }`}
                >
                  {DAY_SHORT[day]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Start time</p>
            <Input
              type="time"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              className="h-8 text-sm w-32"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={isPending} className="h-7 text-xs">
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setAdding(false); setSelectedDays(new Set()); setError(null); }}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
