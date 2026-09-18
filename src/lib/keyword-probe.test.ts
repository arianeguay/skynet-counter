import { expect, test } from 'bun:test';
import { BEAT_RATIO, collisions, probeTerms, verdictOf, type ProbeRow } from './keyword-probe';
import { cybersecurite } from './domains/cybersecurite';

const row = (summary: string, score = 0, title = 'A headline'): ProbeRow => ({ title, summary, score });

test('a term is counted once per article, not once per occurrence', () => {
  const [stat] = probeTerms([row('breach breach breach'), row('nothing here')], ['breach']);
  expect(stat!.hits).toBe(1);
  expect(stat!.ratio).toBe(0.5);
});

test('the title is part of the haystack', () => {
  // A hydrated page is 4000 characters of body prose and the headline is not in
  // it, so a term that only ever appears in headlines would read as dead.
  const [stat] = probeTerms([{ title: 'Zero-day exploited', summary: 'body', score: 8 }], ['zero-day']);
  expect(stat!.hits).toBe(1);
});

test('punctuation and accents fold the same way the matcher folds them', () => {
  const rows = [row('a supply chain attack'), row('a supply-chain attack')];
  expect(probeTerms(rows, ['supply-chain attack'])[0]!.hits).toBe(2);
});

test('rescues counts only the articles the live table scores at zero', () => {
  const rows = [row('weaponized the bug', 0), row('weaponized a breach', 5), row('unrelated', 0)];
  const [stat] = probeTerms(rows, ['weaponiz']);
  expect(stat!.hits).toBe(2);
  expect(stat!.rescues).toBe(1);
  expect(stat!.meanScore).toBe(2.5);
});

// The two thresholds the method turns on. A term firing on 40%+ of a corpus is
// measuring the beat (STU-1218 on `data center`); one firing zero times is dead
// weight (STU-1217, thirteen of fifteen domotique keywords).
test('the beat and dead verdicts sit on the measured thresholds', () => {
  // `agentic` lands in two of five — exactly the threshold, which is a beat word.
  const corpus = [row('agentic'), row('agentic quiet'), row('x'), row('y'), row('z')];
  expect(BEAT_RATIO).toBe(0.4);
  expect(verdictOf(probeTerms(corpus, ['agentic'])[0]!)).toBe('beat');
  expect(verdictOf(probeTerms(corpus, ['quiet'])[0]!)).toBe('ok');
  expect(verdictOf(probeTerms(corpus, ['never said'])[0]!)).toBe('dead');
});

test('an empty corpus reports zero rather than dividing by it', () => {
  const [stat] = probeTerms([], ['breach']);
  expect(stat).toEqual({ term: 'breach', hits: 0, ratio: 0, meanScore: 0, rescues: 0 });
});

test('stats sort by hits so the beat words surface first', () => {
  const rows = [row('breach'), row('breach'), row('jailbreak')];
  expect(probeTerms(rows, ['jailbreak', 'breach']).map((s) => s.term)).toEqual(['breach', 'jailbreak']);
});

// The matcher scans by substring, so a candidate that contains an existing entry
// pays it twice on the same article and one contained by an entry hides it.
test('collisions are reported in both directions and never against itself', () => {
  expect(collisions('breach notification', cybersecurite.keywords)).toEqual(['breach']);
  expect(collisions('jailbrea', cybersecurite.keywords)).toEqual(['jailbreak']);
  expect(collisions('breach', cybersecurite.keywords)).toEqual([]);
  expect(collisions('exploit chain', cybersecurite.keywords)).toEqual([]);
});

// `jailbreak` contains `breach` under no folding, but `zero-days` finding
// `zero-day` is the inflection the table relies on — the rule is substring, so
// check the real table has no pair, the way the domain tests already assert.
test('the shipped table collides with nothing, which is what makes this check meaningful', () => {
  for (const k of Object.keys(cybersecurite.keywords)) {
    expect([k, collisions(k, cybersecurite.keywords)]).toEqual([k, []]);
  }
});
