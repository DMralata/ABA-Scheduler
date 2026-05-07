import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { TimezoneSettingsForm } from "@/components/settings/TimezoneSettingsForm";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const userTimezone =
    (user.user_metadata?.timezone as string | undefined) ?? null;

  // Default fallback shown next to the "Use center default" option.
  const primaryCenter = await prisma.center.findFirst({
    select: { timezone: true },
    orderBy: { name: "asc" },
  });
  const centerTimezone = primaryCenter?.timezone ?? "America/New_York";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ata-gray-900)", margin: 0 }}>
        Settings
      </h1>
      <p style={{ fontSize: 13, color: "var(--ata-gray-600)", marginTop: 4 }}>
        Personal preferences for how the app renders for you.
      </p>

      <div style={{ marginTop: 24 }}>
        <TimezoneSettingsForm
          initialTimezone={userTimezone}
          centerTimezone={centerTimezone}
        />
      </div>
    </div>
  );
}
