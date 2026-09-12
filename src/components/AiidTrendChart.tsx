import type { YearCount } from '@/lib/aiid';

// A raw bar-per-year list, not an SVG plot: the page's whole point is showing
// an absolute count, so each year's number is printed rather than left for the
// reader to eyeball off a bar's height the way `TrendSparkline`'s tiny accent
// strip gets away with.
export function AiidTrendChart({ data }: { data: YearCount[] }) {
  if (data.length === 0) {
    return (
      <p className="border border-hairline bg-panel p-6 text-sm text-ash">
        No incidents loaded yet. Run the backfill: <code className="text-bone">make backfill-aiid</code>
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.count));

  return (
    <div className="border border-hairline bg-panel p-4">
      <ul className="flex flex-col gap-2">
        {data.map((d) => (
          <li key={d.year} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-xs text-ash tabular-nums">{d.year}</span>
            <div className="h-4 flex-1 bg-hairline/40">
              <div className="h-full bg-bone" style={{ width: `${max > 0 ? (d.count / max) * 100 : 0}%` }} />
            </div>
            <span className="w-10 shrink-0 text-right text-xs text-bone tabular-nums">{d.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ash">
        The last ~6 months are held back: AIID keeps backfilling recent history, so that
        window always reads low while reporting catches up, not because of a real slowdown.
      </p>
    </div>
  );
}
