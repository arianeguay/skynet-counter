import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DOMAINS } from '@/lib/domains';

// STU-1282: `frontend` shipped in STU-1279 and was never added to
// SKYNET_SCHEDULE's default, so nothing ever swept it — no error, the domain sat
// at BASE forever. The loop refuses to start on an *unset* schedule, but a set one
// that simply omits a domain starts fine and is silently wrong.
//
// Reading the compose file's own default rather than duplicating it here, so this
// stays true to what actually runs even if the interval per domain changes.
test('every registered domain is named in docker-compose.yml’s default schedule', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const line = compose.match(/SKYNET_SCHEDULE: \$\{SKYNET_SCHEDULE:-([^}]+)\}/);
  expect(line).not.toBeNull();

  const scheduled = new Set(
    line![1]!
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(':')[0])
  );

  for (const domain of DOMAINS) {
    expect(scheduled.has(domain.slug)).toBe(true);
  }
});
