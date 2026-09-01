'use client';

import { useEffect, useState } from 'react';

// An RGB split on a predictable loop reads as a background animation; on an
// irregular beat it reads as a fault.
export function GlitchNumber({ value }: { value: number }) {
  const [glitching, setGlitching] = useState(false);

  useEffect(() => {
    let clear: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clear = setTimeout(() => {
        setGlitching(true);
        clear = setTimeout(() => {
          setGlitching(false);
          schedule();
        }, 220);
      }, 2500 + Math.random() * 6000);
    };
    schedule();
    return () => clearTimeout(clear);
  }, []);

  return (
    <div className="flex items-baseline justify-center gap-1">
      <span
        key={glitching ? 'on' : 'off'}
        className={`text-[clamp(4rem,18vw,9rem)] leading-none font-bold tabular-nums text-blood ${glitching ? 'glitch' : ''}`}
      >
        {value.toFixed(1)}
      </span>
      <span className="text-[clamp(1.5rem,5vw,2.5rem)] leading-none text-blood-dim">%</span>
    </div>
  );
}
