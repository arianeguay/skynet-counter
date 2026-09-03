import { readSnapshot } from '@/lib/db';
import { DEFAULT_DOMAIN } from '@/lib/domains';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(readSnapshot(DEFAULT_DOMAIN), {
    headers: { 'cache-control': 'no-store' },
  });
}
