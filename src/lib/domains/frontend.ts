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
  // Re-run 2026-09-11 against a mature corpus (29.3 days of history, every feed
  // past a week of its own RSS window): the real rate is 1.2 points of score a
  // day, projecting to a steady signal of ~12 — the counter reads within a
  // point of BASE at every divisor from /8 to /40. There is no divisor that
  // reads this feed set mid-gauge on an ordinary week without shrinking small
  // enough to turn a single article into a false crisis; the domain is
  // genuinely this quiet, not miscalibrated (matches the "few weeks of
  // history" check the 2026-09-03 comment this replaces asked for). 48 stays
  // as the least eventful choice among the tested divisors.
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
