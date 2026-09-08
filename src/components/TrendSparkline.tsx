const WIDTH = 120;
const HEIGHT = 36;
const PAD_X = 4;
const PAD_Y = 6;

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

  const dx = history.length > 1 ? (WIDTH - PAD_X * 2) / (history.length - 1) : 0;
  return history.map((v, i) => {
    const x = PAD_X + i * dx;
    const y = PAD_Y + (1 - (v - effMin) / span) * (HEIGHT - PAD_Y * 2);
    return [x, y];
  });
}

// The daily trend under a domain's gauge, ruled with a top and bottom bounding
// the range and two ticks marking it into thirds — the frame in `--color-ash`,
// the muted text token this page already draws labels and timestamps in, not
// `--color-hairline`. Hairline is #1c1c20 against a near-black background with
// nothing beside it for contrast; the gauge's own dial gets away with that color
// only because its track is a 14px arc, not a 1px line alone in a small strip —
// checked directly, hairline strokes here rendered as good as invisible. A bare
// polyline with nothing to read it against was tried first too, and looked like
// noise rather than a chart — there was no way to tell where in its own range
// any point sat (STU-1290).
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
  const top = PAD_Y;
  const bottom = HEIGHT - PAD_Y;
  const third = PAD_Y + (2 / 3) * (bottom - top);
  const twoThirds = PAD_Y + (1 / 3) * (bottom - top);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-9 w-32"
      role="img"
      aria-label={`Counter over the last ${history.length - 1} days`}
    >
      <line x1={PAD_X} y1={top} x2={WIDTH - PAD_X} y2={top} stroke="var(--color-ash)" opacity="0.5" strokeWidth="1" />
      <line x1={PAD_X} y1={bottom} x2={WIDTH - PAD_X} y2={bottom} stroke="var(--color-ash)" opacity="0.5" strokeWidth="1" />
      <line x1={PAD_X} y1={third} x2={PAD_X + 4} y2={third} stroke="var(--color-ash)" opacity="0.5" strokeWidth="1" />
      <line x1={PAD_X} y1={twoThirds} x2={PAD_X + 4} y2={twoThirds} stroke="var(--color-ash)" opacity="0.5" strokeWidth="1" />
      <polyline
        points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="var(--color-signal)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx={lastX} cy={lastY} r="1.8" fill="var(--color-signal)" />
    </svg>
  );
}
