import { domainBySlug } from '@/lib/domains';
import { summaryResponse, unknownDomain } from '../../responses';

export const dynamic = 'force-dynamic';

// The widget payload for a domain other than the default. It carries the same
// `access-control-allow-origin` as `/api/skynet/summary` because it has the
// same caller: a widget pointed at `smarthome` fetches from a `file://`
// document exactly like one pointed at `cybersecurite`.
export async function GET(_req: Request, { params }: { params: Promise<{ domaine: string }> }) {
  const { domaine } = await params;
  const domain = domainBySlug(domaine);
  if (!domain) return unknownDomain(domaine);
  return summaryResponse(domain.slug);
}
