import { domainBySlug } from '@/lib/domains';
import { snapshotResponse, unknownDomain } from '../responses';

export const dynamic = 'force-dynamic';

// Any registered domain's snapshot. The page route already serves every domain
// from one component; this is the same registry lookup, so a domain added under
// `src/lib/domains/` is reachable over HTTP with nothing here to edit.
export async function GET(_req: Request, { params }: { params: Promise<{ domaine: string }> }) {
  const { domaine } = await params;
  const domain = domainBySlug(domaine);
  if (!domain) return unknownDomain(domaine);
  return snapshotResponse(domain.slug);
}
