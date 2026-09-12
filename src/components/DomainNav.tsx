import Link from 'next/link';
import { DOMAINS, type Domain } from '@/lib/domains';

// The switcher is driven by the registry rather than a hardcoded list of four,
// so a domain appears here the moment its module is added and never before —
// a tab leading to a counter with no feeds behind it reads as a broken site
// rather than as work in progress.
//
// One domain is not a choice, so the domain tabs alone have nothing to render.
// The AIID tab is independent of that count and always renders: it isn't in
// the registry and never will be, so it must not disappear along with a
// switcher that has nothing to switch between.
export function DomainNav({ active, domains = DOMAINS }: { active: string; domains?: Domain[] }) {
  const aiidCurrent = active === 'aiid';

  return (
    <nav aria-label="Domains" className="mb-8 flex flex-wrap gap-px border border-hairline bg-hairline">
      {domains.length >= 2 &&
        domains.map((domain) => {
          const current = domain.slug === active;
          return (
            <Link
              key={domain.slug}
              href={`/${domain.slug}`}
              aria-current={current ? 'page' : undefined}
              className={`flex-1 whitespace-nowrap px-4 py-2.5 text-center text-[10px] tracking-[0.25em] transition-colors ${
                current ? 'bg-panel text-signal' : 'bg-void text-ash hover:text-bone'
              }`}
            >
              {domain.label.toUpperCase()}
            </Link>
          );
        })}
      {/* Not a gauge, so not driven by the registry: one fixed tab to the
          absolute-count trend page, appended after the switcher rather than
          folded into it. */}
      <Link
        href="/aiid"
        aria-current={aiidCurrent ? 'page' : undefined}
        className={`flex-1 whitespace-nowrap px-4 py-2.5 text-center text-[10px] tracking-[0.25em] transition-colors ${
          aiidCurrent ? 'bg-panel text-signal' : 'bg-void text-ash hover:text-bone'
        }`}
      >
        AIID TREND
      </Link>
    </nav>
  );
}
