const CX = 160;
const CY = 172;
const R = 128;
const SPAN = 110; // degrees each side of vertical

// 0deg points up, positive sweeps clockwise.
function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
}

function arc(r: number, from: number, to: number): string {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function Gauge({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  const angle = -SPAN + (clamped / 100) * SPAN * 2;
  const [nx, ny] = polar(R - 26, angle);

  return (
    <svg viewBox="0 0 320 210" className="w-full max-w-[420px]" role="img" aria-label={`Threat level ${clamped} of 100`}>
      <defs>
        <linearGradient id="dial" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-signal-dim)" />
          <stop offset="100%" stopColor="var(--color-signal)" />
        </linearGradient>
        <filter id="burn" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path d={arc(R, -SPAN, SPAN)} fill="none" stroke="var(--color-hairline)" strokeWidth="14" strokeLinecap="round" />
      <path
        d={arc(R, -SPAN, angle)}
        fill="none"
        stroke="url(#dial)"
        strokeWidth="14"
        strokeLinecap="round"
        filter="url(#burn)"
      />

      {Array.from({ length: 21 }, (_, i) => {
        const deg = -SPAN + (i / 20) * SPAN * 2;
        const major = i % 5 === 0;
        const [x1, y1] = polar(R - 24, deg);
        const [x2, y2] = polar(R - (major ? 38 : 32), deg);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={deg <= angle ? 'var(--color-signal)' : 'var(--color-hairline)'}
            strokeWidth={major ? 2 : 1}
          />
        );
      })}

      <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="var(--color-signal)" strokeWidth="2.5" filter="url(#burn)" />
      <circle cx={CX} cy={CY} r="7" fill="var(--color-void)" stroke="var(--color-signal)" strokeWidth="2" />
      <text x={polar(R + 14, -SPAN)[0]} y={polar(R + 14, -SPAN)[1]} className="fill-ash text-[10px]" textAnchor="middle">0</text>
      <text x={polar(R + 14, SPAN)[0]} y={polar(R + 14, SPAN)[1]} className="fill-ash text-[10px]" textAnchor="middle">100</text>
    </svg>
  );
}
