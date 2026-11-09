import { InvestigationPage } from '@/features/investigation/page';
export default async function Page({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <InvestigationPage mint={mint} />;
}
