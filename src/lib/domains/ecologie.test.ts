import { expect, test } from 'bun:test';
import { matchedKeywords, scoreFor } from '@/lib/keywords';
import { cybersecurite } from './cybersecurite';
import { ecologie } from './ecologie';

const matched = (text: string) => matchedKeywords(text, ecologie.keywords);

// The words that pinned the gauge. Measuring 70 hydrated articles from the feed
// set on 2026-09-02, a list carrying these scored 66% of them: they are what every
// article on a climate feed says, so their presence marks the beat rather than a
// story. Putting one back is the regression this guards (STU-1218).
test.each(['emissions', 'data center', 'fossil fuel', 'cooling', 'megawatt', 'drought'])(
  '"%s" is deliberately not a keyword — it fires on the whole beat',
  (word) => {
    expect(ecologie.keywords).not.toHaveProperty(word);
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
  expect(scoreFor(found, ecologie.keywords)).toBeGreaterThan(0);
});

// Climate reporting is written to alarm, so tone must carry no score at all —
// only a quantity or a decision does.
test('an alarmed headline with no quantity and no decision scores zero', () => {
  expect(matched('The planet is burning and nobody in charge seems to care')).toEqual([]);
});

// Two gauges that move together are one gauge shown twice. The domains share a
// subject — compute — so their tables must not share vocabulary.
test('the écologie and cybersécurité tables have no keyword in common', () => {
  const shared = Object.keys(ecologie.keywords).filter((k) => k in cybersecurite.keywords);
  expect(shared).toEqual([]);
});
