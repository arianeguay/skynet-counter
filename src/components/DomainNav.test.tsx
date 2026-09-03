import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Domain } from '@/lib/domains';
import { DomainNav } from './DomainNav';

const domain = (slug: string, label: string): Domain => ({
  slug,
  label,
  tagline: `what ${slug} counts`,
  keywords: {},
  divisor: 32,
  guidance: '',
});

const FOUR = [
  domain('cybersecurite', 'Cybersecurity'),
  domain('domotique', 'Home automation'),
  domain('environment', 'Environment'),
  domain('design', 'Design'),
];

// A one-item switcher is noise, and it is the state the site actually ships in
// until the remaining domains land.
test('a single domain renders no switcher at all', () => {
  expect(renderToStaticMarkup(<DomainNav active="cybersecurite" domains={[FOUR[0]!]} />)).toBe('');
});

test('every domain in the registry gets a link to its own counter', () => {
  const markup = renderToStaticMarkup(<DomainNav active="domotique" domains={FOUR} />);

  for (const d of FOUR) {
    expect(markup).toContain(`href="/${d.slug}"`);
    expect(markup).toContain(d.label.toUpperCase());
  }
});

// Without this the four tabs are indistinguishable, and a screen reader has no
// way to say which counter is on screen.
test('the domain being viewed is the only one marked current', () => {
  const markup = renderToStaticMarkup(<DomainNav active="environment" domains={FOUR} />);
  const current = [...markup.matchAll(/<a[^>]*aria-current="page"[^>]*>/g)];

  expect(current).toHaveLength(1);
  expect(current[0]![0]).toContain('href="/environment"');
});

// The switcher grows out of the registry, so adding a domain module is the whole
// change — nothing here lists the four by hand.
test('the switcher is driven by the registry, not a hardcoded list', () => {
  const two = renderToStaticMarkup(<DomainNav active="cybersecurite" domains={FOUR.slice(0, 2)} />);

  expect(two).toContain('HOME AUTOMATION');
  expect(two).not.toContain('ENVIRONMENT');
  expect(two).not.toContain('DESIGN');
});
