// Skynet Counter — Übersicht desktop widget.
//
// Reads https://skynet-counter.com/api/skynet/summary, which serves the counter,
// its timestamp and its band. Nothing here recomputes any of those: the gauge
// geometry below is the one thing copied out of the site, because Übersicht
// loads a widget as a single file and there is no bundler to import
// `src/components/Gauge.tsx` through. Geometry is safe to copy — it is a dial
// drawing, not a number. Thresholds and scores are not, which is why `status`
// arrives from the server.
//
// `command` is a shell string rather than a `fetch`, so the request never goes
// near the WebView's origin rules — the endpoint sets
// `access-control-allow-origin` anyway, but curl means one less thing to break.

const ENDPOINT = 'https://skynet-counter.com/api/skynet/summary';

// The pipeline sweeps hourly (PIPELINE_INTERVAL, 3600s), so polling at 15
// minutes is already over-sampling a number that moves once an hour.
export const refreshFrequency = 15 * 60 * 1000;

// `--max-time` matters more than it looks: without it a hung request outlives
// the refresh interval and the next one stacks on top of it.
export const command = `curl -sS --max-time 10 '${ENDPOINT}'`;

// Older than three sweeps means the pipeline, the host or the network is down,
// and the counter on screen is fiction. The site's own feed alert waits 24h
// before crying wolf; a widget that shows one number can afford to be quicker.
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

const C = {
  void: '#050505',
  panel: '#0b0b0d',
  hairline: '#1c1c20',
  ash: '#6b6b73',
  bone: '#d6d6d8',
  blood: '#ff2a2a',
  bloodDim: '#7a0f0f',
  amber: '#d99114',
};

export const className = `
  top: 40px;
  left: 40px;
  width: 300px;
  padding: 18px 16px 14px;
  background: ${C.panel}e6;
  border: 1px solid ${C.hairline};
  border-radius: 10px;
  color: ${C.bone};
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  -webkit-font-smoothing: antialiased;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  background-image: radial-gradient(ellipse at 50% 30%, rgba(255, 42, 42, 0.07), transparent 60%);
`;

// --- gauge geometry, ported from src/components/Gauge.tsx ---------------------
const CX = 160;
const CY = 172;
const R = 128;
const SPAN = 110; // degrees each side of vertical

// 0deg points up, positive sweeps clockwise.
function polar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
}

function arc(r, from, to) {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function Gauge({ value }) {
  const clamped = Math.min(100, Math.max(0, value));
  const angle = -SPAN + (clamped / 100) * SPAN * 2;
  const [nx, ny] = polar(R - 26, angle);

  return (
    <svg viewBox="0 0 320 210" style={{ width: '100%', display: 'block' }}>
      <defs>
        <linearGradient id="skynet-dial" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor={C.bloodDim} />
          <stop offset="100%" stopColor={C.blood} />
        </linearGradient>
        <filter id="skynet-burn" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path d={arc(R, -SPAN, SPAN)} fill="none" stroke={C.hairline} strokeWidth="14" strokeLinecap="round" />
      <path
        d={arc(R, -SPAN, angle)}
        fill="none"
        stroke="url(#skynet-dial)"
        strokeWidth="14"
        strokeLinecap="round"
        filter="url(#skynet-burn)"
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
            stroke={deg <= angle ? C.blood : C.hairline}
            strokeWidth={major ? 2 : 1}
          />
        );
      })}

      <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={C.blood} strokeWidth="2.5" filter="url(#skynet-burn)" />
      <circle cx={CX} cy={CY} r="7" fill={C.void} stroke={C.blood} strokeWidth="2" />
      <text x={polar(R + 14, -SPAN)[0]} y={polar(R + 14, -SPAN)[1]} fill={C.ash} fontSize="10" textAnchor="middle">0</text>
      <text x={polar(R + 14, SPAN)[0]} y={polar(R + 14, SPAN)[1]} fill={C.ash} fontSize="10" textAnchor="middle">100</text>
    </svg>
  );
}
// -----------------------------------------------------------------------------

function ago(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'JUST NOW';
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.floor(hours / 24)}D AGO`;
}

const Shell = ({ children }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 9, letterSpacing: '0.4em', color: C.ash, paddingLeft: '0.4em' }}>SKYNET COUNTER</div>
    {children}
  </div>
);

const Dead = ({ note }) => (
  <Shell>
    <div style={{ margin: '22px 0 8px', fontSize: 13, letterSpacing: '0.25em', color: C.amber }}>SIGNAL LOST</div>
    <div style={{ fontSize: 9, letterSpacing: '0.1em', color: C.ash, wordBreak: 'break-word' }}>{note}</div>
  </Shell>
);

export const render = ({ output, error }) => {
  if (error) return <Dead note={String(error)} />;
  if (!output) return <Dead note="NO RESPONSE FROM SKYNET-COUNTER.COM" />;

  let data;
  try {
    data = JSON.parse(output);
  } catch {
    // curl writes its own diagnostics to stderr, but a proxy or an error page
    // answers 200 with HTML — that lands here, not in `error`.
    return <Dead note={output.trim().slice(0, 120).toUpperCase()} />;
  }

  const { counter, updatedAt, status } = data;
  const swept = Date.parse(updatedAt);
  // The API returns the epoch when no sweep has ever written a counter row.
  const never = !swept;
  const age = Date.now() - swept;
  const stale = never || age >= STALE_AFTER_MS;

  return (
    <Shell>
      <div style={{ margin: '10px 0 2px' }}>
        <Gauge value={counter} />
      </div>

      <div
        style={{
          fontSize: 40,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          color: C.blood,
          textShadow: `0 0 18px ${C.bloodDim}`,
        }}
      >
        {counter.toFixed(1)}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, letterSpacing: '0.25em', color: C.blood, paddingLeft: '0.25em' }}>
        {status}
      </div>

      <div style={{ marginTop: 10, fontSize: 9, letterSpacing: '0.1em', color: stale ? C.amber : C.ash }}>
        {never ? 'NEVER RUN' : `LAST SWEEP ${ago(age)}`}
        {stale && !never ? ' — STALE' : ''}
      </div>
    </Shell>
  );
};
