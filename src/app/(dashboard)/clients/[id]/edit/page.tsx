import { notFound } from "next/navigation";
import { getClientById } from "@/lib/queries/clients";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClientForm } from "@/components/clients/ClientForm";
import { ClientAvailabilityPanel } from "@/components/clients/ClientAvailabilityPanel";

interface EditClientPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: EditClientPageProps) {
  const { id } = await params;
  const client = await getClientById(id);

  if (!client) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit — ${client.firstName} ${client.lastName}`}
        description="Update client details."
      />
      <ClientForm client={client} availability={client.availability} />
    </div>
  );
}
