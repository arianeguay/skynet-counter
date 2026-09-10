import { statusLine } from '@/lib/counter';
import { readCounter, readSnapshot } from '@/lib/db';
import { DOMAINS, domainBySlug } from '@/lib/domains';

// The two payloads this API serves, each written once and handed a slug.
//
// There are four routes and only two shapes: `/api/skynet` and
// `/api/skynet/summary` serve `DEFAULT_DOMAIN` because a widget config or a
// bookmark points at them and must keep answering, and `/api/skynet/<slug>`
// and `/api/skynet/<slug>/summary` serve whichever domain is asked for. A
// second copy of either payload is a second place for the widget's contract to
// drift, which is the whole reason `status` is served rather than computed by
// the caller in the first place.

export function snapshotResponse(slug: string): Response {
  return Response.json(readSnapshot(slug), {
    headers: { 'cache-control': 'no-store' },
  });
}

// What a desktop widget needs and nothing else. Two differences from the
// snapshot payload, both of them for that caller:
//
//   - `status` is served rather than computed client-side, so a widget never
//     carries its own copy of the bands in `counter.ts`.
//   - `access-control-allow-origin`, because an Übersicht widget runs its fetch
//     from a `file://` document and sends `Origin: null`. The payload is the
//     same public number the site already renders to anyone.
export function summaryResponse(slug: string): Response {
  const { counter, updatedAt } = readCounter(slug);
  // The band is the domain's, not the risk one: a widget showing STALLED for a
  // progress counter reading 8 is right, and NOMINAL would be nonsense.
  const polarity = domainBySlug(slug)?.polarity ?? 'risk';
  return Response.json(
    { counter, updatedAt, status: statusLine(counter, polarity) },
    {
      headers: {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    }
  );
}

// A slug no module defines is a 404, for the reason `/[domaine]` 404s rather
// than rendering an empty gauge: every read is filtered on the domain column,
// so an unregistered slug returns a counter of 0 and no articles — which is
// indistinguishable over the wire from a domain having a quiet week.
export function unknownDomain(slug: string): Response {
  return Response.json(
    { error: `Unknown domain: ${slug}`, domains: DOMAINS.map((d) => d.slug) },
    { status: 404, headers: { 'cache-control': 'no-store' } }
  );
}
