import { PageHeader } from "@/components/layout/PageHeader";
import { ProposalView } from "@/components/schedule/ProposalView";
import { getPendingProposals } from "@/lib/actions/scheduler";
import { prisma } from "@/lib/prisma";

interface ProposePageProps {
  searchParams: Promise<{ weekOf?: string; centerId?: string }>;
}

export default async function ProposePage({ searchParams }: ProposePageProps) {
  const { weekOf, centerId } = await searchParams;

  // Load existing pending proposals server-side
  let proposals: Awaited<ReturnType<typeof getPendingProposals>> = [];
  let resolvedCenterId = centerId;

  if (weekOf) {
    const weekOfDate = new Date(weekOf);
    if (!isNaN(weekOfDate.getTime())) {
      proposals = await getPendingProposals(weekOfDate);
    }
  }

  // If no centerId was passed, try to find the first center
  let centerTimezone = "America/New_York";
  if (resolvedCenterId) {
    const center = await prisma.center.findUnique({
      where: { id: resolvedCenterId },
      select: { timezone: true },
    });
    if (center?.timezone) centerTimezone = center.timezone;
  } else {
    const center = await prisma.center.findFirst({ select: { id: true, timezone: true } });
    resolvedCenterId = center?.id;
    if (center?.timezone) centerTimezone = center.timezone;
  }

  return (
    <div>
      <PageHeader
        title="Proposed Schedule"
        description="Review auto-completed session proposals before booking."
      />
      <ProposalView
        weekOf={weekOf}
        centerId={resolvedCenterId}
        timezone={centerTimezone}
        initialProposals={proposals as Parameters<typeof ProposalView>[0]["initialProposals"]}
      />
    </div>
  );
}
