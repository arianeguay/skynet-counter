const SIZES = {
  hero: { value: 'text-[clamp(4rem,18vw,9rem)]', unit: 'text-[clamp(1.5rem,5vw,2.5rem)]' },
  bar: { value: 'text-2xl', unit: 'text-sm' },
} as const;

export function GlitchNumber({
  value,
  glitching,
  variant = 'hero',
}: {
  value: number;
  glitching: boolean;
  variant?: keyof typeof SIZES;
}) {
  const size = SIZES[variant];
  return (
    <div className="flex items-baseline gap-1">
      <span
        key={glitching ? 'on' : 'off'}
        className={`${size.value} leading-none font-bold tabular-nums text-blood ${glitching ? 'glitch' : ''}`}
      >
        {value.toFixed(1)}
      </span>
      <span className={`${size.unit} leading-none text-blood-dim`}>%</span>
    </div>
  );
}
