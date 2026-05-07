import { notFound } from "next/navigation";
import { getClientById } from "@/lib/queries/clients";
import { PageHeader } from "@/components/layout/PageHeader";
import { AuthorizationForm } from "@/components/clients/AuthorizationForm";

interface NewAuthorizationPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewAuthorizationPage({ params }: NewAuthorizationPageProps) {
  const { id } = await params;
  const client = await getClientById(id);

  if (!client) notFound();

  return (
    <div>
      <PageHeader
        title="Add Authorization"
        description={`New authorization for ${client.firstName} ${client.lastName}`}
      />
      <AuthorizationForm clientId={id} />
    </div>
  );
}
