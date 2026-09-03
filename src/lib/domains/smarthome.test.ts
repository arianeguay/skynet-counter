import { expect, test } from 'bun:test';
import { matchedKeywords, scoreFor } from '@/lib/keywords';
import { cybersecurite } from './cybersecurite';
import { environment } from './environment';
import { frontend } from './frontend';
import { smarthome } from './smarthome';

const matched = (text: string) => matchedKeywords(text, smarthome.keywords);

test('the counter reads high when a device gains ground', () => {
  expect(smarthome.polarity).toBe('progress');
});

// The two keywords measured to fire on the wrong story and cut before shipping
// (STU-1281): `self-hosted` pulled in unrelated HN posts about generic
// self-hosted software, and `new integration` matched loosely on stories that
// were not really about one.
test.each(['self-hosted', 'new integration', 'zigbee', 'matter'])(
  '"%s" is deliberately not a keyword — it fires on the wrong story or the whole beat',
  (word) => {
    expect(smarthome.keywords).not.toHaveProperty(word);
  }
);

test.each([
  {
    title: 'IoTorero joins Works with Home Assistant',
    summary: 'The integration runs entirely on local control, with no cloud dependency.',
    expected: ['local control', 'no cloud', 'works with home assistant'],
  },
  {
    title: 'Zigbee2MQTT 2.14.0',
    summary: 'This release adds support for three new Aqara sensors.',
    expected: ['adds support for'],
  },
])('$title scores above zero', ({ title, summary, expected }) => {
  const found = matched(`${title} ${summary}`);
  expect(found.sort()).toEqual([...expected].sort());
  expect(scoreFor(found, smarthome.keywords)).toBeGreaterThan(0);
});

// A product review that merely mentions the ecosystem is not the domain's
// subject — the article has to report a device or platform actually gaining
// independence.
test('a review that only names the ecosystem in passing scores zero', () => {
  expect(matched('Our top picks for the best smart plugs this holiday season')).toEqual([]);
});

// Every domain's table must earn its own keywords rather than sharing a gauge
// with a domain that already exists.
test('the smarthome table shares no keyword with the other domains', () => {
  for (const other of [cybersecurite, environment, frontend]) {
    expect(Object.keys(smarthome.keywords).filter((k) => k in other.keywords)).toEqual([]);
  }
});

test('the domain asks about its own subject, not another domain\'s', () => {
  expect(smarthome.question.subject).not.toBe('The Singularity');
  expect(smarthome.question.subject).not.toBe('The Convergence');
});
