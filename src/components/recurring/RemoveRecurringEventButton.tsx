"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteRecurringEvent } from "@/lib/actions/recurring";

export function RemoveRecurringEventButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setLoading(true);
    setError(null);
    deleteRecurringEvent(id)
      .then((result) => {
        if (!result.success) {
          setError(result.error);
          setLoading(false);
          setConfirming(false);
        } else {
          router.refresh();
        }
      })
      .catch(() => {
        setError("Failed to remove. Please try again.");
        setLoading(false);
        setConfirming(false);
      });
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1 shrink-0">
        <p className="text-xs text-muted-foreground">Remove &ldquo;{name}&rdquo;? Future sessions will be deleted.</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleRemove} disabled={loading}>
            {loading ? "Removing…" : "Yes, remove"}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setConfirming(true)} className="shrink-0">
      <Trash2 size={14} className="mr-1.5" />
      Remove
    </Button>
  );
}
