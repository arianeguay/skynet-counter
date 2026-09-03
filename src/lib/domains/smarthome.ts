import type { Domain } from './index';

// Domotique as *risk* has no signal (STU-1217): the smart-home press is product
// press, and the only feed carrying incident vocabulary at volume was CISA's
// industrial advisories — a counter built on them would be an advisory feed
// wearing a label about someone's house. Read as progress it works, because the
// good news in this beat — a device gaining local control, a hub dropping its
// cloud dependency — is published on the same weekly cadence as the bad news
// never was.
//
// Measured 2026-09-03 over 53 hydrated articles across five feeds. First pass
// used three sources and scored 33%, but seven of ten hits were one blog — the
// exact shape the risk attempt failed on, and of `environment`'s own divisor
// being 80% one feed. Widening to five sources, no one of them supplies more
// than ~40% of the score: Home Assistant ~37%, Zigbee2MQTT's release notes
// ~39%, SmartHomeScene ~19%, HN and The Verge the remainder.
//
// Two keywords were dropped after measuring, not before: `self-hosted` pulled
// in HN stories about unrelated self-hosted software (a ticketing system, an
// ebook library) once the feed query included the bare word, and
// `new integration` matched loosely on stories that were not really about one.
// Both are the same failure mode STU-1218 already found for `emissions` —
// vocabulary broad enough to fire on the wrong story.
export const smarthome: Domain = {
  slug: 'smarthome',
  label: 'Smart Home',
  tagline: 'Devices getting free of the cloud they shipped bundled with',
  polarity: 'progress',
  question: { prefix: 'How close are we to', subject: 'The Great Decoupling' },
  // Provisional, like environment's and frontend's. Measured at 4.0 score/day —
  // genuinely low volume, not a sampling artifact, since three of the five feeds
  // publish on a weeks-not-days cadence. /4 is chosen so an ordinary week clears
  // SOME MOVEMENT rather than reading STALLED most weeks despite real activity;
  // re-run `bun run calibrate` once this has swept for a few weeks.
  divisor: 4,
  keywords: {
    'local control': 14,
    'no cloud': 14,
    'adds support for': 12,
    'thread border router': 12,
    'open source firmware': 12,
    'works with home assistant': 10,
  },
  guidance: [
    'This domain scores a device or a hub gaining independence: local control',
    'instead of a vendor cloud, open firmware instead of a locked one, a new',
    'integration that works with an open platform. High is good — the counter',
    'measures ground gained, not danger.',
    '',
    "`adds support for` fires on nearly every Zigbee2MQTT release, because that",
    'is what those release notes report every time — expected, not a sign the',
    'keyword is too broad.',
    '',
    'Drop a keyword that names a device or a platform without naming the gain —',
    'a product review that merely mentions Zigbee or Matter in passing, a survey',
    'or a community post that discusses local control as a topic rather than',
    'reporting one. The same rule as any domain: presence is necessary, not',
    'sufficient.',
  ].join('\n'),
};
