import { expect, test } from 'bun:test';
import { DOMAINS, domainBySlug } from '@/lib/domains';
import config, { RETIRED_SLUGS } from './next.config';

const redirects = async () => (await config.redirects!()) as {
  source: string;
  destination: string;
  permanent: boolean;
}[];

test('the domain renamed from écologie keeps answering on its old path', async () => {
  expect(await redirects()).toContainEqual({
    source: '/ecologie',
    destination: '/environment',
    permanent: true,
  });
});

// A retired slug that is also a live one would shadow a real counter: the
// redirect runs before `/[domaine]`, so that domain's page would be unreachable.
test('no retired slug is also a registered domain', () => {
  const shadowed = Object.keys(RETIRED_SLUGS).filter((slug) => domainBySlug(slug));
  expect(shadowed).toEqual([]);
});

// The other half: a rename that forgot to add the new slug would redirect into a
// 404, which is worse than the 404 the redirect exists to prevent.
test('every retired slug points at a domain that exists', () => {
  const dangling = Object.entries(RETIRED_SLUGS).filter(([, to]) => !domainBySlug(to));
  expect(dangling).toEqual([]);
});

test('every redirect is permanent, so the old URL stops being crawled', async () => {
  for (const r of await redirects()) expect(r.permanent).toBe(true);
});

// The rename is only finished if nothing still calls the domain by its old name.
test('no domain is registered under the retired slug', () => {
  expect(DOMAINS.map((d) => d.slug)).toEqual(['cybersecurite', 'environment']);
});
