"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteRecurringEvent } from "@/lib/actions/recurring";

interface Props {
  id: string;
  name: string;
}

export function DeleteRecurringEventButton({ id, name }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    const result = await deleteRecurringEvent(id);
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      setConfirming(false);
    } else {
      router.push("/recurring");
      router.refresh();
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Delete &ldquo;{name}&rdquo; and all future sessions?</span>
        <Button variant="destructive" size="sm" disabled={loading} onClick={handleDelete}>
          {loading ? "Deleting…" : "Yes, delete"}
        </Button>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
      <Trash2 size={14} className="mr-1.5" />
      Delete
    </Button>
  );
}
