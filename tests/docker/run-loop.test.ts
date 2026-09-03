import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '../../docker/run-loop.sh');

// The loop is driven entirely by `studio run`, so a stub on PATH that records the
// domain it was called with is enough to watch the schedule without a sweep, a
// feed or a model anywhere near it.
function stage({ failing = '' }: { failing?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-loop-'));
  const log = join(dir, 'sweeps.log');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, '.studio'));
  writeFileSync(join(dir, '.studio', 'config.example.yaml'), '');
  writeFileSync(
    join(bin, 'studio'),
    `#!/bin/sh\necho "$SKYNET_DOMAIN" >> ${log}\n[ "$SKYNET_DOMAIN" = "${failing}" ] && exit 1\nexit 0\n`
  );
  chmodSync(join(bin, 'studio'), 0o755);

  const run = (schedule: string) =>
    Bun.spawn(['sh', SCRIPT], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SKYNET_SCHEDULE: schedule,
        SKYNET_STATE_DIR: join(dir, 'state'),
        MAX_SLEEP: '1',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

  const sweeps = (): string[] => {
    try {
      return readFileSync(log, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  return { run, sweeps };
}

// Polls rather than sleeping a fixed span, so a slow machine waits longer instead
// of failing.
async function until(check: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(50);
  }
}

// The container is the only caller, and it always supplies a schedule. An empty
// one is a misconfiguration, not "use the usual domain" — sweeping a slug nobody
// asked for would write rows no page reads.
test('an unset schedule stops the loop rather than guessing a domain', async () => {
  const { run, sweeps } = stage();
  const proc = run('');
  const code = await proc.exited;

  expect(code).toBe(1);
  expect(sweeps()).toEqual([]);
});

// The whole point of the issue: a domain that publishes one article a week must
// not be billed for an hourly scoring stage because a busier one needs it.
test('a domain on a short interval sweeps repeatedly while a slow one sweeps once', async () => {
  const { run, sweeps } = stage();
  const proc = run('fast:1 slow:3600');
  try {
    await until(() => sweeps().filter((d) => d === 'fast').length >= 3);
  } finally {
    proc.kill();
    await proc.exited;
  }

  expect(sweeps().filter((d) => d === 'fast').length).toBeGreaterThanOrEqual(3);
  expect(sweeps().filter((d) => d === 'slow')).toEqual(['slow']);
});

// Taking turns in one loop trades away process isolation, so a failing sweep must
// not be able to stop the loop — the `||` this replaces was already load-bearing.
test('a domain whose sweep fails does not stop the others', async () => {
  const { run, sweeps } = stage({ failing: 'broken' });
  const proc = run('broken:1 healthy:1');
  try {
    await until(() => sweeps().filter((d) => d === 'healthy').length >= 3);
  } finally {
    proc.kill();
    await proc.exited;
  }

  expect(sweeps().filter((d) => d === 'broken').length).toBeGreaterThanOrEqual(3);
  expect(sweeps().filter((d) => d === 'healthy').length).toBeGreaterThanOrEqual(3);
});

// A container bounce that re-swept every domain would turn a restart into four
// paid scoring stages, and reset a slow domain's clock every time.
test('a restart does not re-sweep a domain that is not due yet', async () => {
  const { run, sweeps } = stage();

  const first = run('slow:3600');
  try {
    await until(() => sweeps().length >= 1);
  } finally {
    first.kill();
    await first.exited;
  }
  expect(sweeps()).toEqual(['slow']);

  const second = run('slow:3600');
  await Bun.sleep(1500);
  second.kill();
  await second.exited;

  expect(sweeps()).toEqual(['slow']);
});
