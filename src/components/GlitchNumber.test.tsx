import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlitchNumber } from './GlitchNumber';

// Default stays `glitch`, so a caller that predates `effect` — none left in this
// repo, but the prop is optional on purpose — keeps its old markup.
test('glitching with no effect given still tears, not glows', () => {
  const markup = renderToStaticMarkup(<GlitchNumber value={41.3} glitching />);
  expect(markup).toContain('glitch');
  expect(markup).not.toContain('glow');
});

test('a progress domain\'s effect renders glow, never glitch', () => {
  const markup = renderToStaticMarkup(<GlitchNumber value={17} glitching effect="glow" />);
  expect(markup).toContain('glow');
  expect(markup).not.toContain('glitch');
});

// Between beats there is no fault class of either kind — a static number reads
// as calm, not mid-animation.
test('not glitching renders neither class, whatever effect is set', () => {
  const risk = renderToStaticMarkup(<GlitchNumber value={41.3} glitching={false} effect="glitch" />);
  const progress = renderToStaticMarkup(<GlitchNumber value={17} glitching={false} effect="glow" />);
  expect(risk).not.toContain('glitch');
  expect(progress).not.toContain('glow');
});
