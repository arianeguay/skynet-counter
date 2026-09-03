import Link from 'next/link';
import { DOMAINS, type Domain } from '@/lib/domains';

// The switcher is driven by the registry rather than a hardcoded list of four,
// so a domain appears here the moment its module is added and never before —
// a tab leading to a counter with no feeds behind it reads as a broken site
// rather than as work in progress.
//
// One domain is not a choice, so there is nothing to render. This lights up on
// its own when the second one lands.
export function DomainNav({ active, domains = DOMAINS }: { active: string; domains?: Domain[] }) {
  if (domains.length < 2) return null;

  return (
    <nav aria-label="Domains" className="mb-8 flex flex-wrap gap-px border border-hairline bg-hairline">
      {domains.map((domain) => {
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
    </nav>
  );
}
