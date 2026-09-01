'use client';

import { useEffect, useRef, useState } from 'react';
import { Gauge } from './Gauge';
import { GlitchNumber } from './GlitchNumber';

function statusLine(counter: number): string {
  if (counter >= 60) return 'CONTAINMENT DEGRADED';
  if (counter >= 35) return 'ELEVATED ACTIVITY';
  if (counter >= 18) return 'BACKGROUND CHATTER';
  return 'NOMINAL';
}

export function CounterHero({
  counter,
  updatedAt,
  scored,
}: {
  counter: number;
  updatedAt: string;
  scored: number;
}) {
  const hero = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [glitching, setGlitching] = useState(false);
  const stale = Date.parse(updatedAt) === 0;
  const status = statusLine(counter);

  // One beat for every glitching element — independent timers would read as
  // several unrelated faults instead of one.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setGlitching(true);
        timer = setTimeout(() => {
          setGlitching(false);
          schedule();
        }, 220);
      }, 2500 + Math.random() * 6000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const node = hero.current;
    if (!node) return;
    // The hero itself, not a 1px sentinel below it: a sentinel is out of view
    // both above and below, so a large scroll jump crosses it without ever
    // changing intersection state and the callback never fires. The hero sits
    // at the top of the document, so "not intersecting" can only mean the
    // scroll is past it.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setPinned(!entry.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header
        aria-hidden={!pinned}
        className={`fixed inset-x-0 top-0 z-40 border-b border-hairline bg-void/85 backdrop-blur-sm transition-transform duration-300 motion-reduce:transition-none ${
          pinned ? 'translate-y-0' : '-translate-y-[110%]'
        }`}
      >
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-2.5">
          <span className="text-[10px] tracking-[0.3em] text-ash">SKYNET</span>
          <GlitchNumber value={counter} glitching={glitching} variant="bar" />
          <span className="truncate text-[10px] tracking-[0.2em] text-blood">{status}</span>
          <span className="ml-auto shrink-0 text-[10px] text-ash tabular-nums">{scored} SCORED</span>
        </div>
        <div className="h-px w-full bg-hairline">
          <div
            className="h-px bg-blood transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, counter))}%` }}
          />
        </div>
      </header>

      <section ref={hero} className="vignette flex flex-col items-center gap-6 border border-hairline bg-panel/40 px-6 py-14">
        <p className="text-xs tracking-[0.4em] text-ash">SKYNET COUNTER</p>
        <p className="text-sm tracking-[0.25em] text-blood">
          How close are we to{' '}
          {/* inline-block: a bare inline span ignores the animation's transform. */}
          <span className={`inline-block ${glitching ? 'glitch' : ''}`}>The Singularity</span>?
        </p>
        <Gauge value={counter} />
        <GlitchNumber value={counter} glitching={glitching} />
        <p className="text-sm tracking-[0.25em] text-blood">{status}</p>
        <p className="text-xs text-ash">
          {stale ? 'NEVER RUN' : `LAST SWEEP ${updatedAt.slice(0, 19).replace('T', ' ')}Z`}
          <span className="mx-2 text-hairline">|</span>
          {scored} ARTICLES SCORED
        </p>
      </section>
    </>
  );
}
