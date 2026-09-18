import type { Polarity } from '@/lib/counter';
import { aiBusiness } from './ai-business';
import { cybersecurite } from './cybersecurite';
import { environment } from './environment';
import { frontend } from './frontend';
import { smarthome } from './smarthome';

export interface Domain {
  // The route segment, the `SKYNET_DOMAIN` value and the `domain` column's
  // value, all at once: one string, so a domain cannot end up spelled two ways
  // between the sweep that writes a row and the page that reads it.
  slug: string;
  label: string;
  // What this counter counts, printed under the gauge. Keep it at or under ~58
  // characters: the hero draws it in a fixed `max-w-md` column, and the two that
  // had run to 68 wrapped to a second line holding a single orphaned word. The
  // `text-balance` on that paragraph is the backstop rather than the licence —
  // it splits a long tagline evenly, it does not stop the wrap.
  tagline: string;
  keywords: Record<string, number>;
  // What the counter is about, as opposed to what goes wrong inside it. A
  // keyword table measures severity and can only do that inside a subject it is
  // allowed to assume; a domain whose feeds carry more than its own beat has to
  // state that subject instead, and an article mentioning none of these terms
  // scores nothing whatever else it contains (STU-1291). Optional, and absent is
  // the right answer for a domain whose feed list is already the filter.
  //
  // Matched whole-token by `mentionsSubject`, so plurals are spelled out.
  subject?: readonly string[];
  // Which way is up for this counter. Two of the four domains this project set out
  // to build have no risk signal at all — nobody publishes their harms as news —
  // while their good news is published weekly, so the number they can carry is a
  // progress one (STU-1279). It decides the bands and the accent colour, nothing
  // in the arithmetic.
  polarity: Polarity;
  // The line under the title, and one of the two things the glitch/glow beat
  // animates: `CounterHero` renders `{prefix} <effect>{subject}</effect>?`, so
  // `subject` is the animated slot and it is terminal by construction.
  //
  // Every domain shares the prefix and differs only in the subject, which has to
  // name *an arrival this domain can approach*. That is a rule about the word
  // rather than a house style. `environment` read "What is the machine
  // drinking?", which animated a verb while the real subject sat stranded in the
  // prefix, and `ai-business` read "Who is funding The Machine?" — an entity,
  // and nothing is ever close to a machine. The animation is what made both
  // obvious: it lands on whatever is in the slot, correct or not.
  //
  // The subject also carries no valence of its own, because the polarity class
  // is what paints it red or green. "The Singularity" is dreaded and "The
  // Convergence" is wished for, and the identical sentence carries both.
  question: { prefix: string; subject: string };
  // A live panel from somewhere else, drawn under the counter. Optional, and one
  // per domain at most: it is context for the gauge, not a second gauge.
  //
  // It is a field on the domain rather than a `slug === '...'` branch in the
  // page for the reason the feed list, the divisor and the guidance are: the
  // page renders whatever domain it is handed, and nothing in it knows which.
  embed?: { title: string; src: string; height: number };
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
export const DOMAINS: Domain[] = [cybersecurite, environment, aiBusiness, frontend, smarthome];

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
