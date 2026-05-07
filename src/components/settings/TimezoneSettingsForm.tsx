"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserTimezone, SUPPORTED_TIMEZONES } from "@/lib/actions/users";

const TIMEZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern Time (New York)",
  "America/Chicago": "Central Time (Chicago)",
  "America/Denver": "Mountain Time (Denver)",
  "America/Phoenix": "Arizona (no DST)",
  "America/Los_Angeles": "Pacific Time (Los Angeles)",
  "America/Anchorage": "Alaska Time (Anchorage)",
  "Pacific/Honolulu": "Hawaii (Honolulu)",
};

const CENTER_DEFAULT = "__center_default__";

interface TimezoneSettingsFormProps {
  initialTimezone: string | null;
  centerTimezone: string;
}

export function TimezoneSettingsForm({
  initialTimezone,
  centerTimezone,
}: TimezoneSettingsFormProps) {
  const [value, setValue] = useState<string>(initialTimezone ?? CENTER_DEFAULT);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  function handleSave() {
    setStatus(null);
    setIsSaving(true);
    const tzToSave = value === CENTER_DEFAULT ? null : value;
    updateUserTimezone(tzToSave)
      .then((result) => {
        setIsSaving(false);
        if (result.success) {
          setStatus({ kind: "ok", msg: "Saved. Reload the schedule view to see changes." });
        } else {
          setStatus({ kind: "err", msg: result.error });
        }
      })
      .catch(() => {
        setIsSaving(false);
        setStatus({ kind: "err", msg: "Could not save. Please try again." });
      });
  }

  const centerLabel = TIMEZONE_LABELS[centerTimezone] ?? centerTimezone;

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid var(--ata-gray-200)",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--ata-gray-900)", margin: 0 }}>
        Display timezone
      </h2>
      <p style={{ fontSize: 12, color: "var(--ata-gray-600)", margin: "6px 0 16px" }}>
        Controls how times render on screen and in form pickers. Sessions are still scheduled and
        stored in the center&apos;s timezone — this only changes what you see.
      </p>

      <div className="space-y-1.5" style={{ maxWidth: 360 }}>
        <Label>Timezone</Label>
        <Select value={value} onValueChange={(v) => setValue(v ?? CENTER_DEFAULT)}>
          <SelectTrigger>
            <SelectValue placeholder="Select a timezone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CENTER_DEFAULT}>
              Use center default ({centerLabel})
            </SelectItem>
            {SUPPORTED_TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {TIMEZONE_LABELS[tz] ?? tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
        {status && (
          <span
            style={{
              fontSize: 12,
              color:
                status.kind === "ok"
                  ? "var(--ata-success-600, #16a34a)"
                  : "var(--ata-danger-600, #dc2626)",
            }}
          >
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}
