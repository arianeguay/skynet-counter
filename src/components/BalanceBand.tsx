import { balanceOf, balanceVerdict, type DomainDeviation } from '@/lib/balance';

// balance ranges [-2, 2] — each side's average of a [-1, 1]-clamped deviation,
// then one side subtracted from the other. Mapped to a 0-100% marker position:
// -2 (light side at its most ahead) sits at the left edge, +2 at the right.
const BALANCE_SPAN = 2;

function markerPercent(balance: number): number {
  return Math.max(0, Math.min(100, ((balance + BALANCE_SPAN) / (2 * BALANCE_SPAN)) * 100));
}

// The whole registry's risk domains against its progress domains, each compared
// to its own recent normal rather than to each other's raw counter — the trap
// this exists to avoid is treating two different divisors as one shared unit
// (STU-1280). Renders on every domain page, not just the one currently open,
// and renders nothing at all with no domain on one side: a bar with only one
// end populated is not a balance, it is a single reading pretending to be one.
export function BalanceBand({ deviations }: { deviations: DomainDeviation[] }) {
  const balance = balanceOf(deviations);
  if (balance === null) return null;

  const verdict = balanceVerdict(balance);
  const percent = markerPercent(balance);

  return (
    <section aria-label="Signal balance" className="mb-8">
      <div className="mb-2 flex items-center justify-between text-[10px] tracking-[0.25em] text-ash">
        <span>LIGHT SIDE</span>
        <span className="text-bone">{verdict}</span>
        <span>DARK SIDE</span>
      </div>
      <div
        className="relative h-1.5 rounded-full"
        style={{ background: 'linear-gradient(to right, var(--color-verdant-dim), var(--color-hairline), var(--color-blood-dim))' }}
      >
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-void"
          style={{
            left: `${percent}%`,
            transform: 'translate(-50%, -50%)',
            background: balance >= 0 ? 'var(--color-blood)' : 'var(--color-verdant)',
          }}
        />
      </div>
    </section>
  );
}
