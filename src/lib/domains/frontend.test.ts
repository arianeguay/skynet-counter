import { expect, test } from 'bun:test';
import { matchedKeywords, scoreFor } from '@/lib/keywords';
import { cybersecurite } from './cybersecurite';
import { environment } from './environment';
import { frontend } from './frontend';

const matched = (text: string) => matchedKeywords(text, frontend.keywords);

test('the counter reads high when the platform gains ground', () => {
  expect(frontend.polarity).toBe('progress');
});

// The words that made the three risk framings fail: they name the subject of an
// article about AI and design, not an event (STU-1219).
test.each(['ai-generated', 'agentic', 'accessibility', 'baseline', 'slop'])(
  '"%s" is deliberately not a keyword — it marks the beat, not a change',
  (word) => {
    expect(frontend.keywords).not.toHaveProperty(word);
  }
);

test.each([
  {
    title: 'Baseline monthly digest: what is newly available',
    summary: 'Anchor positioning is newly available across every engine.',
    expected: ['newly available'],
  },
  {
    title: 'Container queries are now widely available',
    summary: 'The technique is cross-browser, so the fallback can go.',
    expected: ['widely available', 'cross-browser'],
  },
])('$title scores above zero', ({ title, summary, expected }) => {
  const found = matched(`${title} ${summary}`);
  expect(found.sort()).toEqual([...expected].sort());
  expect(scoreFor(found, frontend.keywords)).toBeGreaterThan(0);
});

// A launch is not ground gained. The counter measures a capability arriving
// everywhere, which is the opposite of one browser shipping first.
test('an announcement with no availability claim scores zero', () => {
  expect(matched('Chrome announces an origin trial for a new API behind a flag')).toEqual([]);
});

// Two gauges that move together are one gauge shown twice, and this domain shares
// its subject — the web — with the security one.
test('the front-end table shares no keyword with the risk domains', () => {
  for (const other of [cybersecurite, environment]) {
    expect(Object.keys(frontend.keywords).filter((k) => k in other.keywords)).toEqual([]);
  }
});

// The prefix stays "How close are we to" — the shared sentence shape across
// domains — but the subject is this domain's own answer, not the risk one's.
test('the domain asks about its own subject, not the risk one', () => {
  expect(frontend.question.subject).not.toBe('The Singularity');
  expect(frontend.question.subject).toBe('The Convergence');
  expect(`${frontend.question.prefix} ${frontend.question.subject}`).toBe(
    'How close are we to The Convergence'
  );
});
