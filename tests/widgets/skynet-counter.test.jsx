import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { render } from '../../widgets/ubersicht/skynet-counter.jsx';

// Not beside the widget, and not for the reason `tests/studio/` exists: Übersicht
// loads *every* `.jsx` in its widgets directory as a widget, so a test file
// sitting next to `skynet-counter.jsx` would be installed as a second, broken
// one. It is a `.jsx` rather than a `.tsx` because `tsconfig.json` sets
// `allowJs: false` and includes only `.ts`/`.tsx` — a typed test importing the
// untyped widget fails `bun run typecheck`, while this file is simply not
// tsc's business.

const draw = (props) => renderToStaticMarkup(render(props));

const sweep = (data, agoMs = 60_000) =>
  draw({
    output: JSON.stringify({
      counter: 41.3,
      updatedAt: new Date(Date.now() - agoMs).toISOString(),
      status: 'ELEVATED ACTIVITY',
      ...data,
    }),
  });

test('prints the counter to one decimal and the band the API served', () => {
  const html = sweep({});
  expect(html).toContain('41.3');
  expect(html).toContain('ELEVATED ACTIVITY');
});

// The band is never recomputed here — whatever the endpoint says is what shows,
// which is the whole reason `statusLine` moved into `counter.ts`.
test('does not second-guess the served band', () => {
  expect(sweep({ counter: 4, status: 'CONTAINMENT DEGRADED' })).toContain('CONTAINMENT DEGRADED');
});

// Ported geometry, so it gets a ported assertion: 50 of 100 is the midpoint of a
// dial spanning 110deg each side of vertical, which puts the needle straight up
// at x = CX (160) and y = CY - (R - 26) = 70.
test('points the needle straight up at half scale', () => {
  expect(sweep({ counter: 50 })).toContain('x2="160" y2="70"');
});

// The dial only, not the whole widget: `counterFrom` clamps before the number
// ever reaches the API, so the *printed* figure is the server's business and an
// out-of-range one is not a case this file can pin down.
const dial = (counter) => sweep({ counter }).match(/<svg.*<\/svg>/s)[0];

test('pins the needle at the ends of the dial, never past them', () => {
  expect(dial(140)).toBe(dial(100));
  expect(dial(-20)).toBe(dial(0));
  expect(dial(100)).not.toBe(dial(0));
});

test('marks a sweep older than three hours stale', () => {
  expect(sweep({}, 3 * 60 * 60 * 1000 + 1)).toContain('STALE');
  expect(sweep({}, 2 * 60 * 60 * 1000)).not.toContain('STALE');
});

test('reads a fresh sweep as an age, not a timestamp', () => {
  expect(sweep({}, 12 * 60_000)).toContain('12M AGO');
  expect(sweep({}, 5 * 60 * 60 * 1000)).toContain('5H AGO');
});

// The epoch is what the API serves before any sweep has written a counter row;
// "LAST SWEEP 20000D AGO" would be nonsense.
test('says NEVER RUN rather than dating the epoch', () => {
  const html = draw({
    output: JSON.stringify({ counter: 0, updatedAt: new Date(0).toISOString(), status: 'NOMINAL' }),
  });
  expect(html).toContain('NEVER RUN');
  expect(html).not.toContain('AGO');
});

test('shows the curl failure rather than a stale number when the host is down', () => {
  expect(draw({ error: 'curl: (28) Operation timed out' })).toContain('SIGNAL LOST');
  expect(draw({ output: '' })).toContain('SIGNAL LOST');
});

// A captive portal or a proxy answers 200 with HTML, which reaches `output`
// clean — `error` stays empty and JSON.parse is the only thing that notices.
test('survives a non-JSON body', () => {
  const html = draw({ output: '<html><body>502 Bad Gateway</body></html>' });
  expect(html).toContain('SIGNAL LOST');
  expect(html).toContain('502 BAD GATEWAY');
});
