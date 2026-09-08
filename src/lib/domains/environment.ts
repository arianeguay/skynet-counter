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
  // Provisional. Measured at 51.8 score/day across the feed set, which projects
  // to a steady signal of ~497, so /24 reads 33 on an ordinary week and leaves
  // room to 74 on a tripled one. One feed's RSS window was a single day at the
  // time, and a rate off a one-day window is the mistake STU-1171 records, so
  // re-run `bun run calibrate` against real stored history before trusting this.
  //
  // Now also too small by whatever the subject gate below cuts: it was picked from
  // an ungated score per day that included the oil spills (STU-1291). `calibrate`
  // reports the size of that cut.
  polarity: 'risk',
  question: { prefix: 'What is the machine', subject: 'drinking' },
  divisor: 24,
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
  // come along inside "computed". Crypto mining is deliberately absent: it is
  // the same physics and a different subject, and this counter names AI.
  //
  // Reasoned from the domain's definition, not yet measured against the corpus
  // the way the keyword table was. Run the probe in "Picking a domain's
  // keywords" over a live sweep before trusting `divisor` again — a gate this
  // strict cuts the score per day, and the divisor was picked from the ungated
  // rate.
  subject: [
    'ai',
    'artificial intelligence',
    'machine learning',
    'neural network',
    'neural networks',
    'llm',
    'llms',
    'large language model',
    'large language models',
    'chatbot',
    'chatbots',
    'chatgpt',
    'openai',
    'anthropic',
    'deepmind',
    'nvidia',
    'data center',
    'data centers',
    'data centre',
    'data centres',
    'datacenter',
    'datacenters',
    'server farm',
    'server farms',
    'supercomputer',
    'supercomputers',
    'hyperscaler',
    'hyperscalers',
    'gpu',
    'gpus',
    'cloud computing',
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
