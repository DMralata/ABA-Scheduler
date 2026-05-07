"use client";

import { useState } from "react";
import type { ClientAvailability, DayOfWeek } from "@prisma/client";
import { setClientAvailability } from "@/lib/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";

const DAYS: DayOfWeek[] = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu",
  FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun",
};

function fmt12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${mStr}${suffix}`;
}

interface ClientAvailabilityPanelProps {
  clientId: string;
  availability: ClientAvailability[];
}

export function ClientAvailabilityPanel({
  clientId,
  availability: initialAvailability,
}: ClientAvailabilityPanelProps) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);
  const [draftWindows, setDraftWindows] = useState<{ startTime: string; endTime: string }[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(day: DayOfWeek) {
    const existing = availability.filter((a) => a.dayOfWeek === day);
    setDraftWindows(
      existing.length > 0
        ? existing.map((a) => ({ startTime: a.startTime, endTime: a.endTime }))
        : [{ startTime: "08:00", endTime: "17:00" }]
    );
    setEditingDay(day);
    setError(null);
  }

  function cancelEdit() {
    setEditingDay(null);
    setDraftWindows([]);
    setError(null);
  }

  function saveDay() {
    if (!editingDay) return;

    for (const w of draftWindows) {
      if (w.startTime >= w.endTime) {
        setError("End time must be after start time for all windows.");
        return;
      }
    }

    const day = editingDay;
    const windows = [...draftWindows];

    setIsPending(true);
    setClientAvailability(clientId, day, windows)
      .then((result) => {
        setIsPending(false);
        if (!result.success) {
          setError(result.error);
          return;
        }
        setAvailability((prev) => [
          ...prev.filter((a) => a.dayOfWeek !== day),
          ...windows.map((w, i) => ({
            id: `draft-${day}-${i}`,
            clientId,
            dayOfWeek: day,
            startTime: w.startTime,
            endTime: w.endTime,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        ]);
        setEditingDay(null);
        setDraftWindows([]);
      })
      .catch(() => {
        setIsPending(false);
        setError("Failed to save availability.");
      });
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Weekly Availability</h2>

      {error && <p className="text-sm text-destructive mb-3">{error}</p>}

      <div className="divide-y divide-border">
        {DAYS.map((day) => {
          const windows = availability.filter((a) => a.dayOfWeek === day);
          const isEditing = editingDay === day;

          return (
            <div key={day} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium w-10 shrink-0 pt-0.5">
                  {DAY_SHORT[day]}
                </span>

                {isEditing ? (
                  <div className="flex-1 space-y-2">
                    {draftWindows.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        Will be marked as unavailable
                      </p>
                    )}
                    {draftWindows.map((w, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={w.startTime}
                          onChange={(e) => {
                            const updated = [...draftWindows];
                            updated[i] = { ...updated[i], startTime: e.target.value };
                            setDraftWindows(updated);
                          }}
                          className="h-8 text-sm w-32"
                        />
                        <span className="text-muted-foreground text-sm">to</span>
                        <Input
                          type="time"
                          value={w.endTime}
                          onChange={(e) => {
                            const updated = [...draftWindows];
                            updated[i] = { ...updated[i], endTime: e.target.value };
                            setDraftWindows(updated);
                          }}
                          className="h-8 text-sm w-32"
                        />
                        <button
                          onClick={() => setDraftWindows(draftWindows.filter((_, j) => j !== i))}
                          aria-label="Remove window"
                          title="Remove window"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setDraftWindows([...draftWindows, { startTime: "12:00", endTime: "17:00" }])}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus size={12} /> Add window
                    </button>
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" onClick={saveDay} disabled={isPending} className="h-7 text-xs">
                        <Check size={12} className="mr-1" /> Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelEdit} className="h-7 text-xs">
                        <X size={12} className="mr-1" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1">
                    {windows.length === 0 ? (
                      <span className="text-sm text-muted-foreground">Unavailable</span>
                    ) : (
                      <span className="text-sm text-foreground">
                        {windows.map((w) => `${fmt12h(w.startTime)}–${fmt12h(w.endTime)}`).join(", ")}
                      </span>
                    )}
                  </div>
                )}

                {!isEditing && (
                  <button
                    onClick={() => startEdit(day)}
                    aria-label={`Edit ${DAY_SHORT[day]} availability`}
                    title={`Edit ${DAY_SHORT[day]} availability`}
                    className="text-muted-foreground hover:text-primary shrink-0"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
