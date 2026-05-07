import { notFound } from "next/navigation";
import { getProviderById } from "@/lib/queries/providers";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProviderForm } from "@/components/providers/ProviderForm";
import { ProviderAvailabilityPanel } from "@/components/providers/ProviderAvailabilityPanel";

interface EditProviderPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProviderPage({ params }: EditProviderPageProps) {
  const { id } = await params;
  const provider = await getProviderById(id);

  if (!provider) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit — ${provider.firstName} ${provider.lastName}`}
        description="Update provider details."
      />
      <ProviderForm provider={provider} />
      <div className="max-w-xl">
        <ProviderAvailabilityPanel
          providerId={provider.id}
          availability={provider.availability}
        />
      </div>
    </div>
  );
}
