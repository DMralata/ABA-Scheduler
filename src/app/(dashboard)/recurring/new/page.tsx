import { prisma } from "@/lib/prisma";
import { getActiveProviders } from "@/lib/queries/providers";
import { PageHeader } from "@/components/layout/PageHeader";
import { RecurringEventForm } from "@/components/recurring/RecurringEventForm";

export default async function NewRecurringEventPage() {
  const [center, sessionTypes, providers] = await Promise.all([
    prisma.center.findFirst({ select: { id: true, timezone: true } }),
    prisma.sessionType.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getActiveProviders(),
  ]);

  return (
    <div>
      <PageHeader
        title="New Recurring Event"
        description="Set up a recurring session that will be applied to all selected providers."
      />
      <div className="mt-6">
        <RecurringEventForm
          sessionTypes={sessionTypes}
          providers={providers}
          centerId={center?.id ?? ""}
          timezone={center?.timezone ?? "America/New_York"}
        />
      </div>
    </div>
  );
}
