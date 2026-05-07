import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRecurringEventById } from "@/lib/queries/recurring";
import { getActiveProviders } from "@/lib/queries/providers";
import { PageHeader } from "@/components/layout/PageHeader";
import { RecurringEventForm } from "@/components/recurring/RecurringEventForm";
import { DeleteRecurringEventButton } from "@/components/recurring/DeleteRecurringEventButton";
import { AssignToAvailableDaysButton } from "@/components/recurring/AssignToAvailableDaysButton";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditRecurringEventPage({ params }: Props) {
  const { id } = await params;

  const [event, sessionTypes, providers, center] = await Promise.all([
    getRecurringEventById(id),
    prisma.sessionType.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getActiveProviders(),
    prisma.center.findFirst({ select: { id: true, timezone: true } }),
  ]);

  if (!event) notFound();

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title={`Edit: ${event.name}`}
          description="Changes will regenerate all future scheduled sessions from today onward."
        />
        <div className="mt-6 flex items-start gap-2 shrink-0">
          <AssignToAvailableDaysButton id={event.id} />
          <DeleteRecurringEventButton id={event.id} name={event.name} />
        </div>
      </div>
      <div className="mt-6">
        <RecurringEventForm
          sessionTypes={sessionTypes}
          providers={providers}
          centerId={center?.id ?? event.centerId ?? ""}
          timezone={center?.timezone ?? event.timezone}
          event={event}
        />
      </div>
    </div>
  );
}
