'use client';

import { useEffect, useRef, useState } from 'react';
import { statusLine, type Polarity } from '@/lib/counter';
import { Gauge } from './Gauge';
import { GlitchNumber } from './GlitchNumber';

export function CounterHero({
  counter,
  updatedAt,
  scored,
  label,
  tagline,
  polarity,
  question,
}: {
  counter: number;
  updatedAt: string;
  scored: number;
  label: string;
  tagline: string;
  polarity: Polarity;
  question: { prefix: string; subject: string };
}) {
  const hero = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [glitching, setGlitching] = useState(false);
  const stale = Date.parse(updatedAt) === 0;
  const status = statusLine(counter, polarity);
  // A risk counter tears; a progress one glows. Same trigger, same beat — only
  // the fault reads differently, matching each effect's own animation length in
  // globals.css so the class is not yanked mid-animation.
  const effect = polarity === 'progress' ? 'glow' : 'glitch';
  const effectDuration = effect === 'glow' ? 900 : 220;
  // Server and browser sit in different zones, so the local stamp can only be
  // computed after mount; until then the UTC string the server rendered stands.
  const [sweep, setSweep] = useState(`${updatedAt.slice(0, 19).replace('T', ' ')}Z`);

  useEffect(() => {
    setSweep(
      new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'medium' }).format(
        new Date(updatedAt),
      ),
    );
  }, [updatedAt]);

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
        }, effectDuration);
      }, 2500 + Math.random() * 6000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [effectDuration]);

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
          <span className="hidden text-[10px] tracking-[0.3em] text-ash sm:inline">SKYNET</span>
          <span className="truncate text-[10px] tracking-[0.3em] text-bone">
            {label.toUpperCase()}
          </span>
          <GlitchNumber value={counter} glitching={glitching} effect={effect} variant="bar" />
          <span className="truncate text-[10px] tracking-[0.2em] text-signal">{status}</span>
          <span className="ml-auto shrink-0 text-[10px] text-ash tabular-nums">{scored} SCORED</span>
        </div>
        <div className="h-px w-full bg-hairline">
          <div
            className="h-px bg-signal transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, counter))}%` }}
          />
        </div>
      </header>

      <section ref={hero} className="vignette flex flex-col items-center gap-6 border border-hairline bg-panel/40 px-6 py-14">
        <p className="text-xs tracking-[0.4em] text-ash">
          SKYNET COUNTER <span className="text-hairline">/</span>{' '}
          <span className="text-bone">{label.toUpperCase()}</span>
        </p>
        <p className="text-sm tracking-[0.25em] text-signal">
          {question.prefix}{' '}
          {/* inline-block: a bare inline span ignores the animation's transform. */}
          <span className={`inline-block ${glitching ? effect : ''}`}>{question.subject}</span>?
        </p>
        <p className="max-w-md text-center text-xs text-ash">{tagline}</p>
        <Gauge value={counter} />
        <GlitchNumber value={counter} glitching={glitching} effect={effect} />
        <p className="text-sm tracking-[0.25em] text-signal">{status}</p>
        <p className="text-xs text-ash">
          {stale ? 'NEVER RUN' : `LAST SWEEP ${sweep}`}
          <span className="mx-2 text-hairline">|</span>
          {scored} ARTICLES SCORED
        </p>
      </section>
    </>
  );
}
