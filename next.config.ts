import type { NextConfig } from 'next';

// Slugs a domain used to answer on. A counter's URL is the kind of thing that
// ends up in a bookmark, a widget config or someone else's link, so renaming one
// leaves the old path answering rather than 404ing.
//
// A retired slug must never also be a live one: `/[domaine]` would resolve it and
// the redirect would shadow a real counter. `next.config.test.ts` asserts that.
export const RETIRED_SLUGS: Record<string, string> = {
  ecologie: 'environment',
};

const config: NextConfig = {
  serverExternalPackages: ['bun:sqlite'],
  async redirects() {
    return Object.entries(RETIRED_SLUGS).map(([from, to]) => ({
      source: `/${from}`,
      destination: `/${to}`,
      permanent: true,
    }));
  },
};

export default config;
