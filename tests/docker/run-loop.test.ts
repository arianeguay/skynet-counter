import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '../../docker/run-loop.sh');

// The loop is driven entirely by `studio run`, so a stub on PATH that records the
// domain it was called with is enough to watch the schedule without a sweep, a
// feed or a model anywhere near it.
function stage({ failing = '', aiidInterval = 3600 }: { failing?: string; aiidInterval?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-loop-'));
  const log = join(dir, 'sweeps.log');
  const marked = join(dir, 'marked.log');
  const aiidLog = join(dir, 'aiid.log');
  const state = join(dir, 'state');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, '.studio'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, '.studio', 'config.example.yaml'), '');
  // The stub also reports whether the sweep marker was in place while it ran —
  // that is the only moment its presence can be observed, since the loop clears
  // it the instant the sweep returns.
  writeFileSync(
    join(bin, 'studio'),
    `#!/bin/sh\necho "$SKYNET_DOMAIN" >> ${log}\n[ -f ${state}/sweeping ] && echo "$SKYNET_DOMAIN" >> ${marked}\n[ "$SKYNET_DOMAIN" = "${failing}" ] && exit 1\nexit 0\n`
  );
  chmodSync(join(bin, 'studio'), 0o755);
  // A real bun script, invoked the way the loop actually invokes it
  // (`bun scripts/aiid-sync.ts`), not a stub on PATH.
  writeFileSync(join(dir, 'scripts', 'aiid-sync.ts'), `console.log("ran"); require("fs").appendFileSync("${aiidLog}", "ran\\n");`);

  const run = (schedule: string) =>
    Bun.spawn(['sh', SCRIPT], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SKYNET_SCHEDULE: schedule,
        SKYNET_STATE_DIR: state,
        MAX_SLEEP: '1',
        AIID_SYNC_INTERVAL: String(aiidInterval),
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

  const markedDuring = (): string[] => {
    try {
      return readFileSync(marked, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  const aiidRuns = (): string[] => {
    try {
      return readFileSync(aiidLog, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  const marker = join(state, 'sweeping');

  return { run, sweeps, markedDuring, aiidRuns, marker, state };
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

// The deploy watcher reads this marker to avoid rebuilding the container a sweep
// is running in — a scoring stage that gets SIGTERM has already been billed for
// the tokens it will never write.
test('a sweep is marked while it runs and unmarked once it returns', async () => {
  const { run, sweeps, markedDuring, marker } = stage();
  const proc = run('fast:1');
  try {
    await until(() => sweeps().length >= 2);
  } finally {
    proc.kill();
    await proc.exited;
  }

  expect(markedDuring().length).toBeGreaterThanOrEqual(2);
  expect(existsSync(marker)).toBe(false);
});

// A container killed mid-sweep leaves the marker behind, and nothing inside a
// stopped container can clear it. Left there, it would defer every deploy from
// then on.
test('a marker left by a killed container is cleared at startup', async () => {
  const { run, sweeps, marker, state } = stage();
  mkdirSync(state, { recursive: true });
  writeFileSync(marker, '1');
  // Not due for an hour, so nothing re-creates the marker during the check.
  writeFileSync(join(state, 'slow.due'), String(Math.floor(Date.now() / 1000) + 3600));

  const proc = run('slow:3600');
  try {
    await until(() => !existsSync(marker));
  } finally {
    proc.kill();
    await proc.exited;
  }

  expect(existsSync(marker)).toBe(false);
  expect(sweeps()).toEqual([]);
});

// The AIID trend page's ingestion runs on its own schedule, independent of the
// domain sweeps above: a plain script, not a Studio pipeline, and not on the
// hourly cadence the gauge feeds need.
test('the AIID sync runs on its own schedule, independent of domain sweeps', async () => {
  const { run, sweeps, aiidRuns } = stage({ aiidInterval: 1 });
  const proc = run('slow:3600');
  try {
    await until(() => aiidRuns().length >= 2);
  } finally {
    proc.kill();
    await proc.exited;
  }

  expect(aiidRuns().length).toBeGreaterThanOrEqual(2);
  // The domain schedule is untouched: `slow` is due once every hour, so it
  // sweeps on startup and does not sweep again inside the test's window.
  expect(sweeps()).toEqual(['slow']);
});

// A restart must not re-run the sync before its own interval is up, the same
// property a domain's `.due` file already gives the studio sweeps.
test('a restart does not re-run the AIID sync before it is due', async () => {
  const { run, aiidRuns } = stage({ aiidInterval: 3600 });

  const first = run('slow:3600');
  try {
    await until(() => aiidRuns().length >= 1);
  } finally {
    first.kill();
    await first.exited;
  }
  expect(aiidRuns()).toEqual(['ran']);

  const second = run('slow:3600');
  await Bun.sleep(1500);
  second.kill();
  await second.exited;

  expect(aiidRuns()).toEqual(['ran']);
});
