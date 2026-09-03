import type { Domain } from './index';

// The one design framing that measures. Three attempts read as risk found nothing
// usable — displacement vocabulary fires zero times, and the broad AI vocabulary
// scores a glossary highest (STU-1219). Read as progress it works, because the
// good news in this domain is published on a release cycle: browsers ship
// features and say so, every week, in the same words.
//
// Measured 2026-09-03 over 70 hydrated articles from these feeds: 27% score, six
// of the seven feeds contribute, and every keyword below names an event rather
// than a subject (STU-1279).
export const frontend: Domain = {
  slug: 'frontend',
  label: 'Front-end',
  tagline: 'Capabilities landing in every browser, not just the newest one',
  polarity: 'progress',
  question: { prefix: 'How close are we to', subject: 'The Convergence' },
  // Provisional, like environment's. Measured at 81.2 score/day, but A List Apart's
  // RSS window held a single day and supplied 74 of that — the one-day extrapolation
  // STU-1171 exists to warn about. Re-run `bun run calibrate` once this has stored
  // a few weeks of history.
  divisor: 48,
  keywords: {
    'available in all browsers': 14,
    'newly available': 14,
    'no longer need a polyfill': 13,
    'widely available': 12,
    'cross-browser': 12,
    interoperable: 11,
    'progressive enhancement': 9,
    'shipping in': 7,
  },
  guidance: [
    'This domain scores the web platform getting better: a capability becoming',
    'usable everywhere rather than behind a flag, a prefix or a polyfill. High is',
    'good here — the counter measures ground gained, not danger.',
    '',
    'The judgement to make is availability versus announcement. "Newly available"',
    'in a Baseline digest means every engine ships it, and counts. The same words',
    'about one browser\'s origin trial or a feature behind a flag do not: an',
    'experiment is not ground gained, and a single-engine launch is the fragmentation',
    'this counter exists to notice ending.',
    '',
    'Drop a keyword that names the *absence* of the thing — "still not interoperable",',
    '"no cross-browser support yet" — for the same reason a risk domain drops a',
    'story about the problem being solved.',
  ].join('\n'),
};
