const WIDTH = 120;
const HEIGHT = 28;
const PAD = 3;

// Below this many points of real spread, expand symmetrically around the series'
// own min/max rather than drawing whatever tiny real variance exists edge-to-edge
// — a difference of 0.3 should not fill the strip the same way a difference of 40
// does, and a genuinely flat run should center rather than hug an edge.
const MIN_SPAN = 4;

// The trend's own range, not the gauge's 0-100: the gauge right next to this
// already shows absolute position, so the sparkline's only job is shape of
// change. A fixed 0-100 domain was tried first and made every real domain read
// as a flat line — cybersecurite's actual 10-70 point swing occupies barely a
// third of the strip when squeezed against a ceiling nothing here gets near
// (STU-1290).
function pointsFor(history: number[]): [number, number][] {
  const min = Math.min(...history);
  const max = Math.max(...history);
  const pad = Math.max(0, MIN_SPAN - (max - min)) / 2;
  const effMin = min - pad;
  const span = max - min + pad * 2;

  const dx = history.length > 1 ? (WIDTH - PAD * 2) / (history.length - 1) : 0;
  return history.map((v, i) => {
    const x = PAD + i * dx;
    const y = PAD + (1 - (v - effMin) / span) * (HEIGHT - PAD * 2);
    return [x, y];
  });
}

// The daily trend under a domain's gauge — no axes, no gridlines, no tooltip,
// just the line the rest of the page already draws its accent with.
//
// `history` is already clipped by `readCounterTrend` to how long the domain has
// actually been swept, so this never has to guess whether a flat run at the left
// edge is real quiet or the domain not existing yet: fewer than two points means
// there is no trend to show, and nothing renders rather than a lone dot standing
// in for "we don't know" (STU-1290).
export function TrendSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;

  const points = pointsFor(history);
  const [lastX, lastY] = points.at(-1)!;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-7 w-32"
      role="img"
      aria-label={`Counter over the last ${history.length - 1} days`}
    >
      <polyline
        points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="var(--color-signal)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
      <circle cx={lastX} cy={lastY} r="1.8" fill="var(--color-signal)" />
    </svg>
  );
}
