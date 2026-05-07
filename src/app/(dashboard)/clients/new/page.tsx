import { PageHeader } from "@/components/layout/PageHeader";
import { ClientForm } from "@/components/clients/ClientForm";

export default function NewClientPage() {
  return (
    <div>
      <PageHeader title="Add Client" description="Create a new client record." />
      <ClientForm />
    </div>
  );
}
