import { notFound } from "next/navigation";
import { getAuthorizationById } from "@/lib/queries/authorizations";
import { getClientById } from "@/lib/queries/clients";
import { PageHeader } from "@/components/layout/PageHeader";
import { AuthorizationForm } from "@/components/clients/AuthorizationForm";

interface EditAuthorizationPageProps {
  params: Promise<{ id: string; authId: string }>;
}

export default async function EditAuthorizationPage({ params }: EditAuthorizationPageProps) {
  const { id, authId } = await params;

  const [client, authorization] = await Promise.all([
    getClientById(id),
    getAuthorizationById(authId),
  ]);

  if (!client || !authorization || authorization.clientId !== id) notFound();

  return (
    <div>
      <PageHeader
        title="Edit Authorization"
        description={`${client.firstName} ${client.lastName}`}
      />
      <AuthorizationForm clientId={id} authorization={authorization} />
    </div>
  );
}
