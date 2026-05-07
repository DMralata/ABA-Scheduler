import { getCoverageAuditData } from "@/lib/queries/coverage";
import { PageHeader } from "@/components/layout/PageHeader";
import { CoverageAudit } from "@/components/admin/CoverageAudit";

export default async function CoverageAuditPage() {
  const { providers, clients, weekStart } = await getCoverageAuditData();

  const weekLabel = weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 4); // Friday
  const weekEndLabel = weekEnd.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div>
      <PageHeader
        title="Coverage Audit"
        description={`Week of ${weekLabel} – ${weekEndLabel} · HOME and HYBRID clients`}
      />
      <CoverageAudit
        providers={providers}
        clients={clients}
        weekLabel={`${weekLabel} – ${weekEndLabel}`}
      />
    </div>
  );
}
