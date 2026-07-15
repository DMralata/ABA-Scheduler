import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClientForm } from "@/components/clients/ClientForm";

export default async function NewClientPage() {
  const centers = await prisma.center.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader title="Add Client" description="Create a new client record." />
      <ClientForm centers={centers} />
    </div>
  );
}
