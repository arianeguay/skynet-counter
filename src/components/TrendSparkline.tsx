const WIDTH = 120;
const HEIGHT = 36;
const PAD_X = 4;
const PAD_Y = 6;

// The gauge's own 0-100, not the series' own min/max. Autoscaling was tried
// first (STU-1290) so a real swing always filled the strip, but that means the
// ruling lines below carry no fixed meaning — the top line is "today's max",
// not "100", and reading two domains' sparklines side by side tells you
// nothing about which is louder in absolute terms, only which moved more
// relative to itself. A fixed domain gives up that per-domain resolution
// deliberately: a domain hugging 88-96 draws a near-flat line near the top
// of the strip, but "near the top" is itself the information — the previous
// version could not draw that at all, because it stretched the same 8-point
// wobble to fill the whole strip on every domain, flat or not.
function pointsFor(history: number[]): [number, number][] {
  const dx = history.length > 1 ? (WIDTH - PAD_X * 2) / (history.length - 1) : 0;
  return history.map((v, i) => {
    const x = PAD_X + i * dx;
    const y = PAD_Y + (1 - v / 100) * (HEIGHT - PAD_Y * 2);
    return [x, y];
  });
}

// The daily trend under a domain's gauge, ruled with a top and bottom at 100
// and 0 and two ticks marking 67 and 33 — the frame in `--color-ash`, the
// muted text token this page already draws labels and timestamps in, not
// `--color-hairline`. Hairline is #1c1c20 against a near-black background with
// nothing beside it for contrast; the gauge's own dial gets away with that color
// only because its track is a 14px arc, not a 1px line alone in a small strip —
// checked directly, hairline strokes here rendered as good as invisible. A bare
// polyline with nothing to read it against was tried first too, and looked like
// noise rather than a chart — there was no way to tell where in the gauge's own
// 0-100 any point sat (STU-1290). Fixing the domain (see `pointsFor`) means
// these four lines now carry the same meaning on every domain's page, unlike
// the autoscaled version where the top line was whatever that domain's own
// maximum happened to be that day.
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
