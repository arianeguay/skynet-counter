import { CounterHero } from '@/components/CounterHero';
import { ArticleLog } from '@/components/ArticleLog';
import { FeedAlert } from '@/components/FeedAlert';
import { readSnapshot } from '@/lib/db';
import { DEFAULT_DOMAIN } from '@/lib/domains';

export const dynamic = 'force-dynamic';

export default function Home() {
  const { counter, updatedAt, articles, feedErrors } = readSnapshot(DEFAULT_DOMAIN);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <CounterHero counter={counter} updatedAt={updatedAt} scored={articles.length} />

      <FeedAlert feedErrors={feedErrors} />

      <section className="mt-10">
        <h2 className="mb-3 text-xs tracking-[0.3em] text-ash">/// SIGNAL LOG</h2>
        <ArticleLog articles={articles} />
      </section>
    </main>
  );
}
