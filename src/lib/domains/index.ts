import { cybersecurite } from './cybersecurite';
import { ecologie } from './ecologie';

export interface Domain {
  // The route segment, the `SKYNET_DOMAIN` value and the `domain` column's
  // value, all at once: one string, so a domain cannot end up spelled two ways
  // between the sweep that writes a row and the page that reads it.
  slug: string;
  label: string;
  // What this counter counts, printed under the gauge.
  tagline: string;
  keywords: Record<string, number>;
  // DIVISOR is picked from a feed set's measured score per day, so it does not
  // travel between domains: a domain publishing a tenth of the volume would read
  // a tenth of the counter on cybersecurity's constant. BASE, HALF_LIFE_DAYS and
  // HORIZON_DAYS stay shared in `counter.ts` — they describe how news ages and
  // where the floor sits, which is not a per-domain fact.
  divisor: number;
  // The judgement calls that only make sense inside this domain, handed to the
  // scorer through the `dedupe` output. `.studio/invariants.md` is injected into
  // every agent by Studio and carries the rules that hold for all domains; this
  // carries the rest.
  guidance: string;
}

// A domain's feed list lives in `.studio/inputs/<slug>.input.yaml`, not in its
// module here: the `fetch` map stage fans out over `input.feeds`, and Studio
// reads YAML, not TypeScript. A second copy in this directory is the trap
// STU-1191 already cost a sweep — the feed table stays in one place per domain.
export const DOMAINS: Domain[] = [cybersecurite, ecologie];

export const DEFAULT_DOMAIN = cybersecurite.slug;

export function domainBySlug(slug: string): Domain | undefined {
  return DOMAINS.find((d) => d.slug === slug);
}

// Read per call rather than captured at import, for the same reason `dbPath()`
// is: a module-load capture lets whichever file imports this one first decide
// the domain for the whole process.
export function currentDomain(): Domain {
  const slug = process.env.SKYNET_DOMAIN ?? DEFAULT_DOMAIN;
  const domain = domainBySlug(slug);
  if (!domain) {
    throw new Error(
      `SKYNET_DOMAIN=${slug} is not a known domain (${DOMAINS.map((d) => d.slug).join(', ')})`
    );
  }
  return domain;
}
