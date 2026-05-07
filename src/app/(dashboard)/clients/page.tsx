import { getActiveClients, getAllClients } from "@/lib/queries/clients";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClientTable } from "@/components/clients/ClientTable";
import { ClientsHeaderActions } from "@/components/clients/ClientsHeaderActions";

interface ClientsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const { status } = await searchParams;
  const showAll = status === "all";

  const clients = showAll ? await getAllClients() : await getActiveClients();

  const description = showAll
    ? `${clients.length} total client${clients.length !== 1 ? "s" : ""}`
    : `${clients.length} active client${clients.length !== 1 ? "s" : ""}`;

  return (
    <div>
      <PageHeader title="Clients" description={description} action={<ClientsHeaderActions />} />
      <ClientTable clients={clients} showAll={showAll} />
    </div>
  );
}
