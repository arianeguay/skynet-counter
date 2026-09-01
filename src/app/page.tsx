import { Gauge } from '@/components/Gauge';
import { GlitchNumber } from '@/components/GlitchNumber';
import { ArticleLog } from '@/components/ArticleLog';
import { readSnapshot } from '@/lib/db';

export const dynamic = 'force-dynamic';

function statusLine(counter: number): string {
  if (counter >= 60) return 'CONTAINMENT DEGRADED';
  if (counter >= 35) return 'ELEVATED ACTIVITY';
  if (counter >= 18) return 'BACKGROUND CHATTER';
  return 'NOMINAL';
}

export default function Home() {
  const { counter, updatedAt, articles } = readSnapshot();
  const stale = Date.parse(updatedAt) === 0;

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <section className="vignette flex flex-col items-center gap-6 border border-hairline bg-panel/40 px-6 py-14">
        <p className="text-xs tracking-[0.4em] text-ash">SKYNET COUNTER</p>
        <Gauge value={counter} />
        <GlitchNumber value={counter} />
        <p className="text-sm tracking-[0.25em] text-blood">{statusLine(counter)}</p>
        <p className="text-xs text-ash">
          {stale ? 'NEVER RUN' : `LAST SWEEP ${updatedAt.slice(0, 19).replace('T', ' ')}Z`}
          <span className="mx-2 text-hairline">|</span>
          {articles.length} ARTICLES SCORED
        </p>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xs tracking-[0.3em] text-ash">/// SIGNAL LOG</h2>
        <ArticleLog articles={articles} />
      </section>
    </main>
  );
}
