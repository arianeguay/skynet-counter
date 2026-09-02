import { statusLine } from '@/lib/counter';
import { readCounter } from '@/lib/db';

export const dynamic = 'force-dynamic';

// What a desktop widget needs and nothing else. Two differences from the
// sibling route, both of them for that caller:
//
//   - `status` is served rather than computed client-side, so a widget never
//     carries its own copy of the bands in `counter.ts`.
//   - `access-control-allow-origin`, because an Übersicht widget runs its fetch
//     from a `file://` document and sends `Origin: null`. The payload is the
//     same public number the site already renders to anyone.
export function GET() {
  const { counter, updatedAt } = readCounter();
  return Response.json(
    { counter, updatedAt, status: statusLine(counter) },
    {
      headers: {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    }
  );
}
