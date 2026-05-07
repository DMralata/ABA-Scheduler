import { PageHeader } from "@/components/layout/PageHeader";
import { ProviderForm } from "@/components/providers/ProviderForm";

export default function NewProviderPage() {
  return (
    <div>
      <PageHeader title="Add Provider" description="Create a new provider record." />
      <ProviderForm />
    </div>
  );
}
