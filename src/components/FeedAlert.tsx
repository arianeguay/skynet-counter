import type { FeedError } from '@/lib/db';

// A publisher's one-off 502 clears itself on the next sweep, so only a failure
// that has outlived a day is worth a warning on a public page.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function downFor(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours < 48 ? `${hours}H` : `${Math.floor(hours / 24)}D`;
}

export function FeedAlert({ feedErrors }: { feedErrors: FeedError[] }) {
  const now = Date.now();
  const dead = feedErrors
    .map((f) => ({ ...f, downMs: now - Date.parse(f.since) }))
    .filter((f) => f.downMs >= STALE_AFTER_MS);

  if (dead.length === 0) return null;

  return (
    <section className="mt-6 border border-amber/50 bg-panel p-4">
      <h2 className="text-xs tracking-[0.3em] text-amber">/// FEED FAULT</h2>
      <p className="mt-2 text-xs text-ash">
        Running on incomplete input &mdash; {dead.length} source{dead.length > 1 && 's'} stopped answering.
      </p>
      <ul className="mt-3 space-y-1">
        {dead.map((f) => (
          <li key={f.source} className="flex flex-col gap-1 text-xs sm:flex-row sm:gap-4">
            <span className="shrink-0 text-bone sm:w-32 sm:truncate">{f.source}</span>
            <span className="shrink-0 text-amber tabular-nums">DOWN {downFor(f.downMs)}</span>
            <span className="min-w-0 flex-1 truncate text-ash/70">{f.error}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
