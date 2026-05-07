"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assignToAvailableDays } from "@/lib/actions/recurring";

type State = "idle" | "loading" | "success" | "error";

export function AssignToAvailableDaysButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setState("loading");
    setMessage(null);
    assignToAvailableDays(id)
      .then((result) => {
        if (!result.success) {
          setState("error");
          setMessage(result.error);
        } else {
          setState("success");
          setMessage(`${result.data.sessionCount} session${result.data.sessionCount !== 1 ? "s" : ""} assigned on ${result.data.days.join(", ")}`);
          router.refresh();
        }
      })
      .catch(() => {
        setState("error");
        setMessage("Something went wrong. Please try again.");
      });
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={state === "loading"}
        className="shrink-0"
      >
        <CalendarCheck size={14} className="mr-1.5" />
        {state === "loading" ? "Assigning…" : "Assign to Available Days"}
      </Button>
      {state === "success" && message && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{message}</p>
      )}
      {state === "error" && message && (
        <p className="text-xs text-destructive">{message}</p>
      )}
    </div>
  );
}
