import { DEFAULT_DOMAIN } from '@/lib/domains';
import { snapshotResponse } from './responses';

export const dynamic = 'force-dynamic';

// The default domain's snapshot, kept at this path because it was the only one
// there was before there were four (STU-1276). `/api/skynet/<slug>` is the
// route that takes an argument.
export function GET() {
  return snapshotResponse(DEFAULT_DOMAIN);
}
