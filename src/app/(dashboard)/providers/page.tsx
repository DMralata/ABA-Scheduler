import { getActiveProviders, getAllProviders } from "@/lib/queries/providers";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProviderTable } from "@/components/providers/ProviderTable";
import { ProvidersHeaderActions } from "@/components/providers/ProvidersHeaderActions";

interface ProvidersPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ProvidersPage({ searchParams }: ProvidersPageProps) {
  const { status } = await searchParams;
  const showAll = status === "all";

  const providers = showAll ? await getAllProviders() : await getActiveProviders();

  return (
    <div>
      <PageHeader
        title="Providers"
        description={`${providers.length} ${showAll ? "total" : "active"} provider${providers.length !== 1 ? "s" : ""}`}
        action={<ProvidersHeaderActions />}
      />

      <ProviderTable providers={providers} showAll={showAll} />
    </div>
  );
}
