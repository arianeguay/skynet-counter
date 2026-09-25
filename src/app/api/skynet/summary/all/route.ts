import { allSummariesResponse } from '../../responses';

export const dynamic = 'force-dynamic';

// Under `summary` rather than beside it, so it claims no new segment a domain
// slug could collide with: `summary` is already reserved.
export function GET() {
  return allSummariesResponse();
}
