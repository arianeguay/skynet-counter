import { expect, test } from 'bun:test';
import { candidateKeywords, matchedKeywords, mentionsSubject, scoreFor } from '@/lib/keywords';
import { cybersecurite } from './cybersecurite';
import { environment } from './environment';

const matched = (text: string) => matchedKeywords(text, environment.keywords);

// The words that pinned the gauge. Measuring 70 hydrated articles from the feed
// set on 2026-09-02, a list carrying these scored 66% of them: they are what every
// article on a climate feed says, so their presence marks the beat rather than a
// story. Putting one back is the regression this guards (STU-1218).
test.each(['emissions', 'data center', 'fossil fuel', 'cooling', 'megawatt', 'drought'])(
  '"%s" is deliberately not a keyword — it fires on the whole beat',
  (word) => {
    expect(environment.keywords).not.toHaveProperty(word);
  }
);

// Real headlines from that sample, and what the domain exists to catch.
test.each([
  {
    title: 'US data centers tripled annual water consumption to 17B gallons',
    summary: 'Depleting an aquifer that supplies three counties.',
    expected: ['water consumption', 'aquifer'],
  },
  {
    title: 'The rush to power data centers is weakening the Clean Air Act',
    summary: 'A coal plant kept open past retirement, with the ratepayer covering it.',
    expected: ['coal plant', 'ratepayer'],
  },
])('$title scores above zero', ({ title, summary, expected }) => {
  const found = matched(`${title} ${summary}`);
  expect(found.sort()).toEqual([...expected].sort());
  expect(scoreFor(found, environment.keywords)).toBeGreaterThan(0);
});

// Climate reporting is written to alarm, so tone must carry no score at all —
// only a quantity or a decision does.
test('an alarmed headline with no quantity and no decision scores zero', () => {
  expect(matched('The planet is burning and nobody in charge seems to care')).toEqual([]);
});

// Two gauges that move together are one gauge shown twice. The domains share a
// subject — compute — so their tables must not share vocabulary.
test('the écologie and cybersécurité tables have no keyword in common', () => {
  const shared = Object.keys(environment.keywords).filter((k) => k in cybersecurite.keywords);
  expect(shared).toEqual([]);
});

// --- the subject gate (STU-1291) ---

const gated = (text: string) => candidateKeywords(text, environment.keywords, environment.subject);

// Reported from the live site: the SIGNAL LOG was carrying an oil spill and a
// story about farms going under on fuel prices. Both are real news, both hold
// this table's vocabulary doing exactly what it was picked to do, and neither is
// about AI compute — which is what the counter's tagline claims to measure. No
// weight on "aquifer" separates them, so the subject does.
test.each([
  {
    what: 'an oil spill',
    text: 'A ruptured pipeline sent 4,000 barrels toward the aquifer that supplies three counties, and the emissions increase from the flaring was visible from orbit.',
  },
  {
    what: 'farms going under on fuel prices',
    text: 'Farmers say gas prices will bankrupt them before harvest; the ratepayer covers the rest and energy demand keeps climbing.',
  },
])('$what matches the table and still scores nothing', ({ text }) => {
  // The table genuinely fires — that is the point, and why a weight cannot fix it.
  expect(matchedKeywords(text, environment.keywords).length).toBeGreaterThan(0);
  expect(gated(text)).toEqual([]);
  expect(scoreFor(gated(text), environment.keywords)).toBe(0);
});

// The stories this domain exists for still score, gate and all.
test.each([
  'US data centers tripled annual water consumption to 17B gallons, depleting an aquifer that supplies three counties.',
  'The rush to power AI is weakening the Clean Air Act: a coal plant kept open past retirement, with the ratepayer covering it.',
  'A UN report puts numbers on the pollution of AI: the energy demand of one training run, and the water usage behind it.',
])('an AI-compute story still scores: %s', (text) => {
  expect(gated(text).length).toBeGreaterThan(0);
  expect(scoreFor(gated(text), environment.keywords)).toBeGreaterThan(0);
});

// A subject list is only a gate if the words in it are absent from the beat it
// is filtering out. These are the ones a climate feed says constantly, and any
// of them here would reopen the hole the gate closes.
test.each(['emissions', 'climate', 'energy', 'power', 'grid', 'water', 'carbon', 'coal', 'gas'])(
  '"%s" is not a subject term — it is the whole climate beat',
  (word) => {
    expect(environment.subject).not.toContain(word);
  }
);

// The gate reads the hydrated page text, not just the headline, so a story whose
// title never says AI is still reachable through its body.
test('the subject may be named anywhere in the article, not only in the title', () => {
  const title = 'Georgia regulators approve three new gas turbines';
  const body = 'The utility told the commission the load is coming from a data center campus outside Atlanta.';
  expect(mentionsSubject(title, environment.subject)).toBe(false);
  expect(gated(`${title} ${body}`).length).toBeGreaterThan(0);
});

// The cost of the gate, written down rather than discovered: a story genuinely
// about the AI buildout that never names it is held back. Nothing in the pipeline
// can recover this one, and it is the trade the gate makes.
test('a compute story that names no compute is held back, and that is the trade', () => {
  const text = 'Georgia regulators approve three new gas turbines to serve a load the utility would not identify.';
  expect(matchedKeywords(text, environment.keywords)).toContain('gas turbine');
  expect(gated(text)).toEqual([]);
});

// --- the French feeds (STU-1292) ---

// Radio-Canada's fils are the first French sources on any domain, and they are
// general press: the fil environnement covers the whole climate beat and the fil
// techno covers all of technology. The gate is what makes them safe to add, so
// these are the cases that prove it points the right way in French.
test.each([
  {
    what: 'a French oil spill quoting a witness',
    // "j'ai" flattens to the token "ai". Before the acronym rule this passed.
    text: "Un déversement menace la nappe phréatique. « J'ai vu l'eau noire », dit un résident.",
  },
  {
    what: 'French climate coverage with no compute in it',
    text: "Les émissions de GES du Québec ont augmenté de 2 % l'an dernier, selon le rapport.",
  },
])('$what scores nothing', ({ text }) => {
  expect(gated(text)).toEqual([]);
});

test.each([
  ["L'IA fait exploser la consommation d'eau des centres de données au Québec.", 13],
  ["Rapport de l'ONU : la demande énergétique de l'IA est largement sous-estimée.", 11],
  ['Une centrale au charbon rouverte pour alimenter un centre de données.', 11],
])('a French AI-compute story scores: %s', (text, expected) => {
  expect(scoreFor(gated(text), environment.keywords)).toBe(expected);
});

// The fil techno will carry plenty of AI stories with no physical cost in them.
// Those are on subject and score zero, which is the correct answer, not a miss.
test('an AI story with no physical quantity in it is on subject and scores zero', () => {
  const text = "L'IA arrive dans les navigateurs web, annonce l'entreprise.";
  expect(mentionsSubject(text, environment.subject)).toBe(true);
  expect(gated(text)).toEqual([]);
});

// A French feed spells a word unaccented in a headline and accented in the body.
test('an unaccented spelling matches the accented keyword', () => {
  expect(gated("L'IA et les centres de donnees font grimper la demande energetique.")).toEqual([
    'demande énergétique',
  ]);
});

// The mirrors carry the same weight as the term they mirror: the same story is
// the same score whichever language reported it.
test.each([
  ['water consumption', "consommation d'eau"],
  ['energy demand', 'demande énergétique'],
  ['aquifer', 'nappe phréatique'],
  ['coal plant', 'centrale au charbon'],
  ['gas turbine', 'turbine à gaz'],
  ['carbon footprint', 'empreinte carbone'],
])('"%s" and "%s" weigh the same', (en, fr) => {
  expect(environment.keywords[fr]).toBe(environment.keywords[en]!);
});
