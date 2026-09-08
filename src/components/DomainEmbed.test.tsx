import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DomainEmbed } from './DomainEmbed';
import { DOMAINS, domainBySlug } from '@/lib/domains';

const EMBED = {
  title: 'LIVE AI METERS',
  src: 'https://widget.example.com/widget?meters=water&theme=dark',
  height: 800,
};

// Every other domain renders the page without one, the same way DomainNav and
// BalanceBand render nothing rather than an empty frame.
test('a domain with no embed renders nothing', () => {
  expect(renderToStaticMarkup(<DomainEmbed embed={undefined} />)).toBe('');
});

test('the frame carries the source, the title and the height', () => {
  const html = renderToStaticMarkup(<DomainEmbed embed={EMBED} />);
  // renderToStaticMarkup escapes the query string's separators.
  expect(html).toContain(`src="${EMBED.src.replace(/&/g, '&amp;')}"`);
  expect(html).toContain('title="LIVE AI METERS"');
  expect(html).toContain('height="800"');
});

// A third-party frame that can navigate the page it sits in, open windows or
// start downloads is a different thing from a stats panel. The sandbox is the
// whole reason this is a component rather than an inline iframe.
test('the frame is sandboxed and leaks no referrer', () => {
  const html = renderToStaticMarkup(<DomainEmbed embed={EMBED} />);
  expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
  expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).toContain('loading="lazy"');
});

// It is served over TLS into a TLS page, and it is a frame from someone else:
// both are things a later edit could quietly drop.
test('every embed in the registry is https', () => {
  for (const domain of DOMAINS) {
    if (domain.embed) expect(domain.embed.src.startsWith('https://')).toBe(true);
  }
});

test('environment carries the AI meters', () => {
  const embed = domainBySlug('environment')?.embed;
  expect(embed?.src).toContain('widget.theaimeters.com');
  expect(embed?.src).toContain('theme=dark');
});
