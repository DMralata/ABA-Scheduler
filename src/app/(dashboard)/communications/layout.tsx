import { getThreads } from "@/lib/queries/communications";
import { CommunicationsShell } from "@/components/communications/CommunicationsShell";

export default async function CommunicationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const threads = await getThreads();

  return (
    <div className="-m-8 overflow-hidden">
      <CommunicationsShell threads={threads}>{children}</CommunicationsShell>
    </div>
  );
}
