"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateOutreachForAffectedParties } from "@/lib/actions/communications";

interface Props {
  cancelledSessionIds: string[];
  changeDescription: string;
  onDismiss: () => void;
}

export function OutreachPromptBanner({
  cancelledSessionIds,
  changeDescription,
  onDismiss,
}: Props) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const result = await generateOutreachForAffectedParties({
      cancelledSessionIds,
      changeDescription,
    });
    setGenerating(false);

    if (result.success) {
      onDismiss();
      router.push("/communications");
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border-b border-blue-200 text-sm">
      <Users size={15} className="text-blue-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-blue-900">Session cancelled.</span>
        <span className="text-blue-700 ml-1">
          Would you like to generate outreach messages for affected parties?
        </span>
        {error && <span className="ml-2 text-red-600 text-xs">{error}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Users size={12} />
          )}
          {generating ? "Generating..." : "Generate Outreach"}
        </Button>
        <button
          onClick={onDismiss}
          className="text-blue-400 hover:text-blue-600 transition-colors"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
