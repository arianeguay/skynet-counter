'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { BANDS, statusLine, type Polarity } from '@/lib/counter';

const HEIGHT = 260;
const PAD_LEFT = 32;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

const PLOT_BOTTOM = HEIGHT - PAD_BOTTOM;
const yFor = (v: number) => PAD_TOP + (1 - v / 100) * (PLOT_BOTTOM - PAD_TOP);

// `history` is `readCounterTrend`'s output: one reading per day, oldest first,
// the last one being `endsAt`'s day. Same fixed 0-100 domain as the sparkline,
// so the band lines mean what the gauge's own thresholds mean.
export function TrendChart({
  history,
  endsAt,
  polarity,
}: {
  history: number[];
  endsAt: number;
  polarity: Polarity;
}) {
  const last = history.length - 1;
  const [active, setActive] = useState(last);
  // The viewBox tracks the rendered width so one unit stays one pixel: a fixed
  // viewBox scaled down to a phone shrank every label to about 5px.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  if (history.length < 2) return null;

  const xTicks = width < 480 ? 3 : 5;
  const dx = (width - PAD_LEFT - PAD_RIGHT) / last;
  const xFor = (i: number) => PAD_LEFT + i * dx;
  const dayOf = (i: number) => new Date(endsAt - (last - i) * 864e5);
  const shortDate = (i: number) =>
    dayOf(i).toLocaleDateString('en', { month: 'short', day: 'numeric' }).toUpperCase();

  const line = history.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
  const area = `${xFor(0).toFixed(1)},${PLOT_BOTTOM} ${line} ${xFor(last).toFixed(1)},${PLOT_BOTTOM}`;
  const ticks = [...new Set(Array.from({ length: xTicks }, (_, k) => Math.round((k * last) / (xTicks - 1))))];

  const min = Math.min(...history);
  const max = Math.max(...history);
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const delta = history[last]! - history[0]!;
  const value = history[active]!;

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    setActive(Math.min(last, Math.max(0, Math.round((x - PAD_LEFT) / dx))));
  };
  const step = (e: KeyboardEvent<SVGSVGElement>) => {
    const move = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!move) return;
    e.preventDefault();
    setActive((i) => Math.min(last, Math.max(0, i + move)));
  };

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-5 gap-2 text-xs sm:gap-3">
        {[
          ['NOW', history[last]!.toFixed(1)],
          ['MIN', min.toFixed(1)],
          ['MAX', max.toFixed(1)],
          ['AVG', mean.toFixed(1)],
          [`Δ${last}D`, `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`],
        ].map(([term, detail]) => (
          <div key={term} className="border border-hairline px-2 py-2 sm:px-3">
            <dt className="text-[10px] tracking-[0.2em] text-ash sm:tracking-[0.3em]">{term}</dt>
            <dd className="text-sm text-bone tabular-nums sm:text-lg">{detail}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-ash tabular-nums" aria-live="polite">
        <span className="text-bone">{dayOf(active).toISOString().slice(0, 10)}</span>
        <span className="mx-2 text-hairline">|</span>
        <span className="text-signal">{value.toFixed(1)}</span>
        <span className="mx-2 text-hairline">|</span>
        {statusLine(value, polarity)}
      </p>

      <div ref={box}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="w-full touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-ash"
        role="img"
        aria-label={`Counter per day over the last ${last} days, from ${history[0]!.toFixed(1)} to ${history[last]!.toFixed(1)}`}
        tabIndex={0}
        onPointerMove={pick}
        onPointerDown={pick}
        onKeyDown={step}
      >
        {[100, ...BANDS[polarity].map(([floor]) => floor)].map((floor) => (
          <g key={floor}>
            <line
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={yFor(floor)}
              y2={yFor(floor)}
              stroke="var(--color-ash)"
              opacity={floor === 0 || floor === 100 ? 0.5 : 0.25}
              strokeDasharray={floor === 0 || floor === 100 ? undefined : '2 4'}
            />
            <text x={PAD_LEFT - 6} y={yFor(floor) + 3} textAnchor="end" fontSize="10" fill="var(--color-ash)">
              {floor}
            </text>
          </g>
        ))}
        {BANDS[polarity].map(([floor, name], i) => (
          <text
            key={name}
            x={width - PAD_RIGHT - 4}
            y={yFor(i === 0 ? 100 : BANDS[polarity][i - 1]![0]) + 12}
            textAnchor="end"
            fontSize="9"
            letterSpacing="1.5"
            fill="var(--color-ash)"
            opacity="0.7"
          >
            {name}
          </text>
        ))}

        {ticks.map((i) => (
          <text
            key={i}
            x={xFor(i)}
            y={HEIGHT - 8}
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} fontSize="10" fill="var(--color-ash)">
            {shortDate(i)}
          </text>
        ))}

        <polygon points={area} fill="var(--color-signal)" opacity="0.08" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-signal)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {history.map((v, i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(v)} r={i === active ? 4 : 1.8} fill="var(--color-signal)" />
        ))}
        <line
          x1={xFor(active)}
          x2={xFor(active)}
          y1={PAD_TOP}
          y2={PLOT_BOTTOM}
          stroke="var(--color-bone)"
          opacity="0.3"
        />
      </svg>
      </div>
    </div>
  );
}
