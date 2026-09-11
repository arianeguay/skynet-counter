import type { Metadata } from 'next';
import { AiidTrendChart } from '@/components/AiidTrendChart';
import { DomainNav } from '@/components/DomainNav';
import { readAiidUpdatedAt, readAiidYearCounts } from '@/lib/db';

// Reads live database state on every request, the same reason `[domaine]/page.tsx`
// stays dynamic: a build-time prerender would freeze the count at whatever it
// read when the image was built.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SKYNET COUNTER · AIID TREND',
  description: "The AI Incident Database's yearly count of reported AI incidents, in absolute terms.",
};

export default function AiidTrendPage() {
  const data = readAiidYearCounts();
  const updatedAt = readAiidUpdatedAt();

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <DomainNav active="aiid" />

      <header className="mb-10">
        <h1 className="text-2xl tracking-[0.15em] text-bone">AIID INCIDENT TREND</h1>
        <p className="mt-2 max-w-prose text-sm text-ash">
          Reported AI incidents per year, from the{' '}
          <a
            href="https://incidentdatabase.ai"
            target="_blank"
            rel="noreferrer"
            className="text-bone underline-offset-4 hover:underline"
          >
            AI Incident Database
          </a>
          . A raw count, not a 0-100 score: no divisor, no keyword weighting, no
          per-domain calibration.
        </p>
      </header>

      <AiidTrendChart data={data} />

      <p className="mt-4 text-xs text-ash">
        {updatedAt ? `Last updated ${updatedAt.slice(0, 10)}` : 'Not yet loaded.'}
      </p>
    </main>
  );
}
