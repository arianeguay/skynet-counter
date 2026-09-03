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
export const ecologie: Domain = {
  slug: 'ecologie',
  label: 'Écologie',
  tagline: 'What AI compute is taking from the grid, the air and the water table',
  // Provisional. Measured at 51.8 score/day across the feed set, which projects
  // to a steady signal of ~497, so /24 reads 33 on an ordinary week and leaves
  // room to 74 on a tripled one. One feed's RSS window was a single day at the
  // time, and a rate off a one-day window is the mistake STU-1171 records, so
  // re-run `bun run calibrate` against real stored history before trusting this.
  divisor: 24,
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
    '  measures what computing takes, not the state of the climate.',
  ].join('\n'),
};
