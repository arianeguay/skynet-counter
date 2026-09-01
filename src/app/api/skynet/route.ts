import { readSnapshot } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(readSnapshot(), {
    headers: { 'cache-control': 'no-store' },
  });
}
