import { AI_SUBJECT } from './ai-subject';
import type { Domain } from './index';

// What the money is doing, read as risk: the capital, the deals and the compute
// contracts piling up behind AI. The other three risk framings this project
// tried and dropped failed because their beat publishes no events (STU-1217,
// STU-1219); business press has the opposite problem — it publishes almost
// nothing *but* events, so the work here is not finding an event vocabulary but
// keeping the beat's own vocabulary out of it.
//
// **Reasoned, not measured.** Every other table in this directory was picked by
// running the probe in CLAUDE.md's "Picking a domain's keywords" over live
// hydrated articles; this one could not be, because the sandbox it was written
// in has no egress to the feeds — the same constraint that shipped
// `environment`'s subject list unmeasured (STU-1291) and Radio-Canada's fils
// unmeasured (STU-1292). Treat the weights and the divisor below as a first
// pass. Run the probe over a week of stored rows, then `bun run calibrate`,
// before trusting either.
export const aiBusiness: Domain = {
  slug: 'ai-business',
  label: 'AI Business',
  tagline: 'The capital, the deals and the compute contracts piling up behind AI',
  // Risk, not progress, and the choice decides what rule 2 means for every
  // article. `frontend` and `smarthome` are progress domains because their
  // events are the platform doing well; money concentrating behind AI is the
  // thing this site was built to watch getting louder, so it reads the same way
  // `cybersecurite` does. Flipping it is one field and the guidance below — but
  // the table would have to be rebuilt with it, since these keywords name the
  // pile growing rather than the market re-pricing it.
  polarity: 'risk',
  question: { prefix: 'Who is funding', subject: 'The Machine' },
  // Unmeasured, and deliberately biased high. The failure that matters is the
  // one STU-1171 records — a divisor too small pegs the gauge at 100 and never
  // comes back down — and this feed set is the highest-volume on the site by a
  // wide margin, two general tech newsrooms' AI categories plus a funding wire.
  // At an assumed ~200 points of score a day it projects to a steady signal of
  // ~1900, so /64 reads 42 on an ordinary week and still has room above. If the
  // real rate is half that it reads 27, which is quiet but legible; the same
  // guess at /32 would read 72 and peg on any busy week. Replace it with
  // `bun run calibrate` against real stored history.
  divisor: 64,
  // Two of this domain's five feeds are not filtered on AI at the source:
  // Crunchbase News is every funding round in every sector, and Stratechery is
  // all of tech strategy. That is the exact shape `environment` had when an oil
  // spill scored 23 on a counter about AI compute (STU-1291) — a table naming
  // events in a world wider than the counter's subject. So the gate runs here
  // too, and it is the shared list rather than a copy: "is this about AI?" is
  // one question, answered in one place.
  //
  // No physical-plant terms, unlike `environment`'s extension of the same list.
  // A data-centre REIT raising a round is a real story on the wrong beat here,
  // and "data center" would let every one of them through the gate — the same
  // term is load-bearing for a counter about what compute takes from the grid
  // and a hole in one about who is funding AI. Read the list for the purpose.
  subject: AI_SUBJECT,
  keywords: {
    'acquisition': 14,
    'capital expenditure': 13,
    'funding round': 12,
    'led the round': 12,
    // Not `valuation`: the matcher scans by substring, and "evaluation" contains
    // it. On a beat where every other article is about model evals that is not a
    // rare collision, it is most of the corpus. "valued at" says the same thing
    // and cannot be reached from "evaluated".
    'valued at': 12,
    // The one entry with a known substring hazard left in it — "tripod",
    // "hippo", "antipode" all contain it, and the matcher has no word
    // boundaries. Kept because the headline form is what funding coverage
    // actually uses and none of those words belong to this beat; it is the first
    // entry to check when the probe finally runs, the way `délestage` is in
    // `environment`.
    'ipo': 11,
    'seed round': 10,
    'licensing deal': 10,
    'multibillion': 10,
    'term sheet': 9,
    'enterprise adoption': 9,
    'market cap': 8,
    'poach': 7,
    'partnership': 7,
    'earnings': 6,
  },
  guidance: [
    'This domain scores capital and market force accumulating behind AI: money',
    'raised, companies bought, compute contracted, a capability being paid for at',
    'scale. The counter reads how much of the economy is being rearranged around',
    'this technology — high is loud, and loud is the thing being watched.',
    '',
    'The bias to correct for here is the opposite of both the other risk domains.',
    'Business press is written to announce, so an article exists because something',
    'happened — which makes the beat itself eventful and the keywords easy to',
    'trigger. What has to be checked is not whether an event occurred but whether',
    'the money is real and is moving toward AI:',
    '',
    '- A keyword inside a forecast, a ranking or a trends piece — "the enterprise',
    '  adoption curve in 2027", a list of the year\'s biggest acquisitions — names',
    '  no transaction. A survey of deals is not a deal.',
    '- A keyword belonging to a company\'s non-AI business. A conglomerate\'s',
    '  quarterly earnings reach you because it also sells models; the article is',
    '  about its retail division. The subject gate catches the article that never',
    '  mentions AI at all, so what is left for you is the one that mentions it in',
    '  passing.',
    '- `partnership` and `earnings` are the two that fire loosest. A partnership',
    '  announcement with no money, no term and no product named is a press',
    '  release; earnings that merely get quoted are not an earnings story.',
    '',
    'Direction is rule 2 here as everywhere, and it points a particular way: this',
    'counter measures the pile growing. An article about the money pulling back —',
    'a down round, a write-down, a deal called off, layoffs at a lab, the bubble',
    'deflating — is the market correcting the thing being counted, not more of it.',
    'Drop the keyword and say so. A deal that closed and was later unwound is',
    'still a deal, the same way a vulnerability that was patched was still a',
    'vulnerability.',
  ].join('\n'),
};
