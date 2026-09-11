import { AI_SUBJECT } from './ai-subject';
import type { Domain } from './index';

// Built from a measurement rather than from what sounds like climate vocabulary
// (STU-1218). 70 hydrated articles across six live feeds on 2026-09-02, scored
// through the same matcher the validator uses.
//
// The words that first suggest themselves — "emissions", "data center", "fossil
// fuel", "cooling" — are what *every* article on a climate feed says, and a list
// carrying them scored 66% of the sample and pinned the gauge at 100 on every
// divisor. They are deliberately absent. What is left names a quantity or a
// decision, so its presence marks a story rather than the beat.
export const environment: Domain = {
  slug: 'environment',
  label: 'Environment',
  tagline: 'What AI compute is taking from the grid, the air and the water table',
  // Calibrated 2026-09-11 (STU-1275) by `bun run calibrate` against the live,
  // gated corpus — replacing the 2026-09-02 guess above, which was picked from
  // Data Center Dynamics's rate off a one-day RSS window, exactly the STU-1171
  // mistake this domain was re-checked for. The gated feed set now publishes
  // 16.5 points of score a day, projecting to a steady signal of ~159: /8 reads
  // 31.8 on an ordinary week and 71.5 on a tripled one, the closest fit among
  // the standard divisors to "mid-gauge with headroom at 3x" (STU-1275's own
  // bar) that the grid actually offers — nothing hits 50 without also pegging
  // the tripled-week case.
  //
  // One caveat this number carries forward: Radio-Canada environnement
  // (STU-1292) has only a 3.5-day RSS window, short of the ~2-week bar this
  // project otherwise waits for before trusting a feed's rate. Its volume is
  // negligible (0.29 articles/day) so it cannot move this number much either
  // way, but re-run calibrate once it matures rather than treating /8 as final.
  polarity: 'risk',
  question: { prefix: 'What is the machine', subject: 'drinking' },
  // TheAIMeters' live totals, under the gauge. The counter above it measures how
  // loudly the press is reporting the cost; this measures the cost itself, in
  // litres and kilowatt-hours. Neither derives from the other, which is the
  // point of showing both — the gauge can sit at its floor through a week nobody
  // wrote about while these keep climbing.
  //
  // The meters are chosen in the query string: prompts, electricity, water, CO2,
  // GPU hours, models published. `theme=dark` because the site has no light mode
  // to follow.
  embed: {
    title: 'LIVE AI METERS',
    src: 'https://widget.theaimeters.com/widget?meters=estimated-ai-prompts-last24h%2Celectricity-ai-today%2Cwater-ai-today%2Cco2-ai-today%2Cgpu-hours-today%2Chuggingface-models&theme=dark&lang=en',
    height: 800,
  },
  divisor: 8,
  // The gate the keyword table cannot supply. Four of this domain's six feeds
  // are general climate press, and its table names quantities in the physical
  // world rather than anything about computing — so an oil spill mentioning an
  // aquifer, and a story about farms going under on fuel prices naming the
  // ratepayer and the energy demand behind it, both scored on a counter whose
  // tagline is AI compute (STU-1291). Both are real stories. Neither is this
  // beat, and no weight on "aquifer" can tell them apart, because the word is
  // doing its job in both.
  //
  // The words here are the ones STU-1218 threw out of the *keyword* table for
  // firing on the whole beat — "data center" above all. That is not a
  // contradiction, it is the same measurement read for the other purpose: a term
  // that appears in nearly every article about compute-and-climate is a useless
  // severity signal and an excellent topicality one. The two lists want opposite
  // properties, which is why they are two lists.
  //
  // Whole-token matched, so the plurals are spelled out and "compute" does not
  // come along inside "computed". The French terms are written unaccented
  // because `normalizeText` folds accents on both sides — "centres de données"
  // in an article reaches this list as "centres de donnees". Crypto mining is deliberately absent: it is
  // the same physics and a different subject, and this counter names AI.
  //
  // Reasoned from the domain's definition, not yet measured against the corpus
  // the way the keyword table was. Run the probe in "Picking a domain's
  // keywords" over a live sweep before trusting this list's own hit rate —
  // `divisor` above is now calibrated against the gated rate (STU-1275), so
  // this list only affects severity weighting, not the counter's overall scale.
  subject: [
    // The half every gated domain shares — the terms that say an article is
    // about AI at all, capitalised acronyms included, so `ai-business` and this
    // one cannot drift apart on the same question (see `ai-subject.ts`).
    ...AI_SUBJECT,
    // This domain's own half: the physical plant. A story can name the buildout
    // — a campus outside Atlanta, a turbine order, a water permit — without ever
    // naming the thing being built, so the gate has to reach it through the
    // hardware as well as through the technology.
    'data center',
    'data centers',
    'data centre',
    'data centres',
    'datacenter',
    'datacenters',
    'centre de donnees',
    'centres de donnees',
    'server farm',
    'server farms',
    'supercomputer',
    'supercomputers',
    'superordinateur',
    'superordinateurs',
    'hyperscaler',
    'hyperscalers',
    'gpu',
    'gpus',
    'cloud computing',
    'infonuagique',
    'compute',
    'inference',
    'training run',
    'training runs',
  ],
  keywords: {
    'water consumption': 13,
    'water usage': 13,
    'grid strain': 12,
    'emissions increase': 12,
    'energy demand': 11,
    'power demand': 11,
    aquifer: 11,
    'coal plant': 11,
    'gas turbine': 10,
    'carbon footprint': 10,
    ratepayer: 9,
    curtailment: 8,
    // The French half, added with Radio-Canada's fils (STU-1292). These are
    // mirrors of the terms above at the same weights, not a separately measured
    // table: the same concept in the other language earns the same score. Only
    // the ones with an exact equivalent are here — "ratepayer" has no clean
    // Québécois counterpart and "grid strain" no settled phrase, so both are
    // simply absent rather than guessed at, which is what STU-1218 says to do
    // with a word that has not been measured.
    "consommation d'eau": 13,
    "utilisation de l'eau": 13,
    'hausse des émissions': 12,
    'demande énergétique': 11,
    'demande en électricité': 11,
    'nappe phréatique': 11,
    'centrale au charbon': 11,
    'turbine à gaz': 10,
    'empreinte carbone': 10,
    // Québec press uses this for hospital scheduling far more than for the
    // grid. It only ever gets a chance to fire inside an article the subject
    // gate has already passed, so the collision is bounded — but it is the
    // first entry to check when the probe runs.
    délestage: 8,
  },
  guidance: [
    'This domain scores what AI compute costs the physical world: water drawn,',
    'power demanded, emissions added, and the decisions that let a data centre',
    'take more of any of them.',
    '',
    'The bias to correct for here is the opposite of cybersecurity\'s. Climate',
    'reporting is written to alarm, so tone carries no information at all — only a',
    'quantity or a specific decision does. Two drops seen repeatedly in the sample',
    'this list was measured on:',
    '',
    '- A keyword inside a general explainer or policy Q&A that names no incident,',
    '  such as "carbon footprint" in a piece surveying a five-year plan.',
    '- A keyword that belongs to a story about climate at large rather than about',
    '  compute — "coal plant" in an essay on burnout, for instance. This counter',
    '  measures what computing takes, not the state of the climate. An article that',
    '  never mentions AI or a data centre at all reaches you with no candidates and',
    '  is already handled; what is left for you is the article that mentions one in',
    '  passing and is about something else.',
    '- A keyword pointing the other way: the article is about the draw going *down*.',
    '  "Reducing on-site water usage" in a story about a cooling system is the',
    '  vendor solving the problem this counter measures, not causing it.',
  ].join('\n'),
};
