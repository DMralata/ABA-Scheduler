import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { ScheduleWorkspace } from "@/components/schedule/ScheduleWorkspace";

export default async function SchedulePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [clients, providers, sessionTypes, centers] = await Promise.all([
    prisma.client.findMany({
      where: {
        OR: [{ terminationDate: null }, { terminationDate: { gt: new Date() } }],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        street: true,
        city: true,
        state: true,
        zip: true,
        availability: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
        authorizations: {
          select: { startDate: true, endDate: true },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),

    prisma.provider.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        availability: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),

    prisma.sessionType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, billable: true, requiresBcba: true },
    }),

    prisma.center.findMany({
      select: { id: true, name: true, timezone: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const primaryCenter = centers[0] ?? null;

  // Display timezone: user preference (set in /settings) overrides the center
  // default. The override is display-only — scheduler internals (propose route,
  // session storage, audit windows) still use the center's timezone for
  // determinism. See src/lib/actions/users.ts.
  const userTimezone = (user.user_metadata?.timezone as string | undefined) ?? null;
  const displayTimezone =
    userTimezone || primaryCenter?.timezone || "America/New_York";

  return (
    <ScheduleWorkspace
      clients={clients}
      providers={providers}
      sessionTypes={sessionTypes}
      centers={centers}
      centerId={primaryCenter?.id ?? null}
      timezone={displayTimezone}
    />
  );
}
