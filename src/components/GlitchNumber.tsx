const SIZES = {
  hero: { value: 'text-[clamp(4rem,18vw,9rem)]', unit: 'text-[clamp(1.5rem,5vw,2.5rem)]' },
  bar: { value: 'text-2xl', unit: 'text-sm' },
} as const;

export function GlitchNumber({
  value,
  glitching,
  variant = 'hero',
  // 'glitch' tears the digits apart; 'glow' lets them breathe. The domain's
  // polarity decides which fires, in CounterHero — a progress counter reads
  // arrival, not corruption.
  effect = 'glitch',
}: {
  value: number;
  glitching: boolean;
  variant?: keyof typeof SIZES;
  effect?: 'glitch' | 'glow';
}) {
  const size = SIZES[variant];
  return (
    <div className="flex items-baseline gap-1">
      <span
        key={glitching ? 'on' : 'off'}
        className={`${size.value} leading-none font-bold tabular-nums text-signal ${glitching ? effect : ''}`}
      >
        {value.toFixed(1)}
      </span>
      <span className={`${size.unit} leading-none text-signal-dim`}>%</span>
    </div>
  );
}
