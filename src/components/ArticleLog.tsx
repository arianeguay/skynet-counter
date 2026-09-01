import type { Article } from '@/lib/db';

function severity(score: number): { label: string; className: string } {
  if (score >= 30) return { label: 'CRIT', className: 'border-blood text-blood' };
  if (score >= 15) return { label: 'HIGH', className: 'border-blood-dim text-blood' };
  if (score > 0) return { label: 'WARN', className: 'border-amber/50 text-amber' };
  return { label: 'NOMINAL', className: 'border-hairline text-ash' };
}

const stamp = (iso: string): string => iso.slice(0, 10);

export function ArticleLog({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <p className="border border-hairline bg-panel p-6 text-sm text-ash">
        No scored articles yet. Run the pipeline: <code className="text-bone">bun run pipeline</code>
      </p>
    );
  }

  return (
    <ul className="divide-y divide-hairline border border-hairline bg-panel">
      {articles.map((a) => {
        const sev = severity(a.score);
        return (
          <li key={a.url} className="group flex flex-col gap-2 p-4 transition-colors hover:bg-hairline/40 sm:flex-row sm:items-start sm:gap-4">
            <span className="shrink-0 text-xs text-ash tabular-nums">{stamp(a.date)}</span>
            <span className="shrink-0 text-xs text-ash/70 sm:w-32 sm:truncate">{a.source}</span>

            <div className="min-w-0 flex-1">
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-bone underline-offset-4 group-hover:text-blood group-hover:underline"
              >
                {a.title}
              </a>
              {a.keywords.length > 0 && (
                <p className="mt-1 text-xs text-ash">
                  {a.keywords.map((k) => `[${k}]`).join(' ')}
                  {a.evidence && <span className="ml-2 italic text-ash/60">&ldquo;{a.evidence}&rdquo;</span>}
                </p>
              )}
            </div>

            <span className={`shrink-0 self-start border px-2 py-0.5 text-xs tabular-nums ${sev.className}`}>
              {String(a.score).padStart(2, '0')} {sev.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
