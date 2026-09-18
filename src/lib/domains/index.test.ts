import { expect, test } from 'bun:test';
import { DOMAINS } from './index';

// The hero draws every domain's question as one sentence with one animated
// slot: `{prefix} <glitch|glow>{subject}</glitch|glow>?`. These hold the shape
// of that sentence across the registry, which is the half no per-domain test can
// see — each of those only knows its own module.

// Not a style preference. The slot is terminal by construction, so a question
// phrased any other way puts the wrong word in it: `environment` read "What is
// the machine drinking?" and animated the verb while its actual subject sat in
// the prefix, and `ai-business` read "Who is funding The Machine?", which is an
// entity rather than something a counter can be close to.
test('every domain asks the same question and differs only in what it names', () => {
  for (const domain of DOMAINS) {
    expect(domain.question.prefix).toBe('How close are we to');
    // An arrival, named: "The " + one capitalised noun, no trailing punctuation
    // (the hero supplies the "?").
    expect(domain.question.subject).toMatch(/^The [A-Z][a-z]+$/);
  }
});

test('no two domains name the same arrival', () => {
  const subjects = DOMAINS.map((d) => d.question.subject);
  expect(new Set(subjects).size).toBe(subjects.length);
});

// The tagline is drawn in a fixed `max-w-md` column. `ai-business` and
// `environment` both ran to 68 characters and wrapped to a second line holding
// one orphaned word ("behind", "table"); the three that fit were 50 to 62. This
// bar sits under the measured break with margin to spare, and `text-balance` on
// that paragraph is the backstop rather than a reason to cross it.
test('no tagline is long enough to wrap the hero column', () => {
  for (const domain of DOMAINS) {
    expect(domain.tagline.length).toBeLessThanOrEqual(58);
  }
});
