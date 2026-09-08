import type { Domain } from '@/lib/domains';

// A live panel from a third party, under the counter. It says nothing about
// this domain's own reading — it is the wider quantity the counter is a local
// sample of — so it is framed as its own section rather than folded into the
// hero, and it is captioned with where it comes from.
//
// Sandboxed. `allow-scripts` and `allow-same-origin` are what a stats widget
// needs to run and to reach its own API; everything else the default denies
// stays denied, which is the part that matters — an embed cannot navigate the
// page it sits in, open a window, or start a download. The two together are
// only dangerous when the frame shares this site's origin, and it does not.
export function DomainEmbed({ embed }: { embed: Domain['embed'] }) {
  if (!embed) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xs tracking-[0.3em] text-ash">/// {embed.title}</h2>
      <div className="border border-hairline bg-panel">
        <iframe
          src={embed.src}
          title={embed.title}
          height={embed.height}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin"
          className="block w-full border-none"
        />
      </div>
    </section>
  );
}
