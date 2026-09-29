import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrendDialog } from './TrendDialog';

test('no trend means no button and no dialog', () => {
  expect(renderToStaticMarkup(<TrendDialog history={[41]} label="Cyber" polarity="risk" />)).toBe('');
});

// The chart mounts on open, so a closed dialog carries only the sparkline button.
test('the sparkline is a button opening a dialog that starts empty', () => {
  const markup = renderToStaticMarkup(<TrendDialog history={[12, 41]} label="Cyber" polarity="risk" />);

  expect(markup).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>.*<svg/);
  expect(markup).toContain('<dialog');
  expect(markup).not.toContain('MIN');
});
