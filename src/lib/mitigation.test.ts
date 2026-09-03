import { expect, test } from 'bun:test';
import { mitigatedMatches } from '@/lib/keywords';

// Every case below is a real article from the live corpus on 2026-09-03, found by
// scanning the 70 scored articles for a mitigation word within five words of a kept
// keyword. Eight matched. They are the whole reason this reports rather than
// suppresses (STU-1277).

// The two the counter genuinely got wrong: the article's subject *is* the remedy.
test.each([
  {
    what: 'a product that lowers water draw',
    text: 'Haffner Energy launches biomass power-cooling system for data centers, reducing on-site water usage',
    keywords: ['water usage'] as string[],
  },
  {
    what: 'a browser defence against the attack it names',
    text: 'Chrome adopts what may be the best protection yet against account takeovers',
    keywords: ['account takeover'] as string[],
  },
])('$what is flagged for a reader to check', ({ text, keywords }) => {
  expect(mitigatedMatches(text, keywords)).toEqual(keywords);
});

// The six that would have been suppressed by a rule that acted on this signal, and
// must not be. In each the incident is the subject and the fix is an aside — these
// are exactly the stories the counter exists to catch.
test.each([
  {
    what: 'a vulnerability that was silently mitigated was still a vulnerability',
    text: 'Microsoft Copilot reveals secret input that allowed it to be hacked. Microsoft silently mitigated the vulnerability.',
    keywords: ['vulnerability'] as string[],
  },
  {
    what: 'refusing to pay a ransom is still a ransomware story',
    text: "Berlin refuses to pay hackers who stole data from the city's network, segmenting networks to prevent ransomware spread.",
    keywords: ['ransomware'] as string[],
  },
  {
    what: 'a patch round-up is still a report of the holes it closes',
    text: 'Microsoft Plugs Nearly 400 Security Holes. Readers turned from the recent patch deluge to vulnerability counts.',
    keywords: ['vulnerability'] as string[],
  },
  {
    what: 'a record patch count is a record flaw count',
    text: 'Microsoft Patches a Record 570 Security Flaws, drawing the burgeoning patch counts to vulnerability tallies.',
    keywords: ['vulnerability'] as string[],
  },
  {
    what: 'an agent exploiting a flaw is the story, not the patch that followed',
    text: 'The Rise and Fall of Agent Civilizations: agents found the exploit, so OpenAI patched this vulnerability.',
    keywords: ['vulnerability'] as string[],
  },
  {
    what: 'a chained exploit is not undone by the hardening that followed',
    // The measured phrasing, word for word: "fix" sits exactly five words before the
    // keyword, which is the edge of the window.
    text: 'Attackers chain two PaperCut flaws to execute code without authentication. The vendor shipped a fix with additional hardening this vulnerability.',
    keywords: ['vulnerability'] as string[],
  },
])('$what still scores', ({ text, keywords }) => {
  // Flagged, because the words really are adjacent — and kept, because the flag is
  // a note and nothing acts on it.
  expect(mitigatedMatches(text, keywords)).toEqual(keywords);
});

test('a keyword with no mitigation word before it is not flagged', () => {
  expect(
    mitigatedMatches('US data centers tripled annual water consumption to 17B gallons', [
      'water consumption',
    ])
  ).toEqual([]);
});

// The window is what keeps the note narrow: a fix mentioned two paragraphs away
// says nothing about the keyword's direction.
test('a mitigation word far from the keyword does not flag it', () => {
  const far = `The breach exposed 40,000 records. ${'filler words here '.repeat(6)} The vendor later patched it.`;
  expect(mitigatedMatches(far, ['breach'])).toEqual([]);
});

test('only the keyword that reads as mitigated is flagged, not its neighbours', () => {
  const text = 'Reducing water usage across the estate, after a ransomware crew encrypted the backups.';
  expect(mitigatedMatches(text, ['water usage', 'ransomware'])).toEqual(['water usage']);
});

test('a keyword absent from the text is never flagged', () => {
  expect(mitigatedMatches('reducing nothing in particular', ['water usage'])).toEqual([]);
});
