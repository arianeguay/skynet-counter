import { expect, test } from 'bun:test';
import { candidateKeywords, matchedKeywords, scoreFor } from '@/lib/keywords';
import { aiBusiness } from './ai-business';
import { cybersecurite } from './cybersecurite';
import { environment } from './environment';
import { frontend } from './frontend';
import { smarthome } from './smarthome';

const matched = (text: string) => matchedKeywords(text, aiBusiness.keywords);
const gated = (text: string) => candidateKeywords(text, aiBusiness.keywords, aiBusiness.subject);

test('the counter reads high when the money piles up', () => {
  expect(aiBusiness.polarity).toBe('risk');
});

// The same rule every table here is picked by: a keyword marks a story, not a
// subject. These are what a tech newsroom's AI category says in every article it
// publishes, so a list carrying them would score the beat (STU-1218).
test.each(['ai', 'startup', 'model', 'investor', 'venture capital', 'billion', 'funding'])(
  '"%s" is deliberately not a keyword — it marks the beat, not a transaction',
  (word) => {
    expect(aiBusiness.keywords).not.toHaveProperty(word);
  }
);

// `valuation` is the obvious entry and it cannot be used: the matcher scans by
// substring, so "evaluation" contains it — on a beat where half the corpus is
// about model evals. `valued at` says the same thing and is unreachable from
// "evaluated".
test('"valuation" is not a keyword, because "evaluation" contains it', () => {
  expect(aiBusiness.keywords).not.toHaveProperty('valuation');
  expect(matched('The evaluation harness was re-run against the new checkpoint.')).toEqual([]);
});

test.each([
  {
    title: 'OpenAI acquires Statsig in a deal valued at $1.1B',
    summary: 'The acquisition is the lab’s largest to date.',
    expected: ['acquisition', 'valued at'],
  },
  {
    title: 'Anthropic closes a Series F',
    summary: 'Nvidia led the round, and the term sheet went out in June.',
    expected: ['led the round', 'term sheet'],
  },
])('$title scores above zero', ({ title, summary, expected }) => {
  const found = gated(`${title} ${summary}`);
  expect(found.sort()).toEqual([...expected].sort());
  expect(scoreFor(found, aiBusiness.keywords)).toBeGreaterThan(0);
});

// Business press announces, so the beat is eventful by default — which makes a
// survey of events the thing that has to score nothing. A ranking of deals is
// not a deal.
test('a forecast with no transaction in it scores zero', () => {
  expect(gated('Our 2027 outlook for AI infrastructure spending, sector by sector.')).toEqual([]);
});

// --- the subject gate ---

// Crunchbase News is every funding round in every sector and Stratechery is all
// of tech strategy, so this table meets articles with nothing to do with AI in
// them — the shape that had `environment` scoring an oil spill at 23 (STU-1291).
test('a funding round in another sector matches the table and still scores nothing', () => {
  const text =
    'A Toronto logistics startup closed a $40M round; OMERS led the round, and the funding round values it at nine figures.';
  expect(matchedKeywords(text, aiBusiness.keywords).length).toBeGreaterThan(0);
  expect(gated(text)).toEqual([]);
  expect(scoreFor(gated(text), aiBusiness.keywords)).toBe(0);
});

// The gate is the shared list, not a copy of it: the terms that say "this is
// about AI" have to mean the same thing on every counter that asks.
test('the subject list is the one every gated domain shares', () => {
  for (const term of aiBusiness.subject!) {
    expect(environment.subject).toContain(term);
  }
});

// …and only that half. `environment` extends the shared list with the physical
// plant because a buildout story can name the campus and never the technology;
// here the same terms would open the gate to every data-centre REIT on the
// funding wire, which is a real story on the wrong beat.
test.each(['data center', 'gpu', 'compute', 'hyperscaler'])(
  '"%s" is not a subject term here, though it is one for environment',
  (term) => {
    expect(aiBusiness.subject).not.toContain(term);
    expect(environment.subject).toContain(term);
  }
);

// --- what this table costs, written down rather than discovered ---

// `ipo` is three letters and the matcher has no word boundaries. Nothing in this
// beat contains it by accident, which is the bet; this is the bet stated, so the
// first probe on real articles knows where to look.
test('"ipo" matches inside an unrelated word, and that is the bet', () => {
  expect(matched('The robot was mounted on a tripod for the demo.')).toEqual(['ipo']);
});

// --- the usual invariants ---

test('the ai-business table shares no keyword with the other domains', () => {
  for (const other of [cybersecurite, environment, frontend, smarthome]) {
    expect(Object.keys(aiBusiness.keywords).filter((k) => k in other.keywords)).toEqual([]);
  }
});

test('the domain asks about its own subject, not another domain’s', () => {
  for (const other of [cybersecurite, environment, frontend, smarthome]) {
    expect(aiBusiness.question.subject).not.toBe(other.question.subject);
  }
});
