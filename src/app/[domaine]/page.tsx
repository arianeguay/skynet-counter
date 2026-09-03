import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CounterHero } from '@/components/CounterHero';
import { ArticleLog } from '@/components/ArticleLog';
import { DomainNav } from '@/components/DomainNav';
import { FeedAlert } from '@/components/FeedAlert';
import { readSnapshot } from '@/lib/db';
import { domainBySlug } from '@/lib/domains';

// Never prerendered. `generateStaticParams` here looks harmless and is not: it
// makes Next bake each domain's page at build time, so the site would serve the
// counter as it stood when the image was built and never move again.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domaine: string }>;
}): Promise<Metadata> {
  const domain = domainBySlug((await params).domaine);
  if (!domain) return {};
  return {
    title: `SKYNET COUNTER — ${domain.label}`,
    description: domain.tagline,
  };
}

export default async function DomainPage({ params }: { params: Promise<{ domaine: string }> }) {
  const domain = domainBySlug((await params).domaine);
  if (!domain) notFound();

  const { counter, updatedAt, articles, feedErrors } = readSnapshot(domain.slug);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <DomainNav active={domain.slug} />

      <CounterHero
        counter={counter}
        updatedAt={updatedAt}
        scored={articles.length}
        label={domain.label}
        tagline={domain.tagline}
      />

      <FeedAlert feedErrors={feedErrors} />

      <section className="mt-10">
        <h2 className="mb-3 text-xs tracking-[0.3em] text-ash">/// SIGNAL LOG</h2>
        <ArticleLog articles={articles} />
      </section>
    </main>
  );
}
