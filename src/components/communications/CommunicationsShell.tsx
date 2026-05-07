import type { ThreadSummary } from "@/lib/queries/communications";
import { InboxClient } from "@/components/communications/InboxClient";
import { AISuggestionsPanel } from "@/components/communications/AISuggestionsPanel";

interface Props {
  threads: ThreadSummary[];
  children: React.ReactNode;
}

export function CommunicationsShell({ threads, children }: Props) {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
        background: "var(--ata-bg)",
      }}
    >
      <InboxClient threads={threads} />
      <main
        style={{
          flex: 1,
          minWidth: 560,
          display: "flex",
          flexDirection: "column",
          background: "#FFFFFF",
          overflow: "hidden",
        }}
      >
        {children}
      </main>
      <AISuggestionsPanel />
    </div>
  );
}
