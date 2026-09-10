import { DEFAULT_DOMAIN } from '@/lib/domains';
import { summaryResponse } from '../responses';

export const dynamic = 'force-dynamic';

// The desktop widget's endpoint, and the reason `summary` is a slug no domain
// may take: a static segment wins over a dynamic sibling in Next's router, so a
// domain registered under that name would be shadowed here rather than served
// by `/api/skynet/<slug>`. `route.test.ts` holds that.
export function GET() {
  return summaryResponse(DEFAULT_DOMAIN);
}
