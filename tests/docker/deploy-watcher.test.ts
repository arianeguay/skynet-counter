import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '../../docker/deploy-watcher.sh');

// The watcher only ever talks to `git` and `docker`, so stubs on PATH prove the
// whole decision table — which commit it deploys, which it refuses, and what it
// records — without a server, a checkout or a build anywhere near it.
function stage() {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-deploy-'));
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  mkdirSync(bin);

  const gitLog = join(dir, 'git.log');
  const dockerLog = join(dir, 'docker.log');
  // Flags the stubs read out of the staging directory, so a test sets one by
  // writing a file rather than by re-generating the stub.
  const target = join(dir, 'target');
  const ancestor = join(dir, 'ancestor');
  const fetchFail = join(dir, 'fetch_fail');
  const mergeFail = join(dir, 'merge_fail');
  const buildFail = join(dir, 'build_fail');
  const sweeping = join(dir, 'sweeping');

  writeFileSync(target, 'cafe1234\n');
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh
echo "$*" >> ${gitLog}
case "$1" in
  fetch) [ -f ${fetchFail} ] && exit 1; exit 0 ;;
  rev-parse) cat ${target}; exit 0 ;;
  merge-base) [ -f ${ancestor} ] && exit 0; exit 1 ;;
  merge) [ -f ${mergeFail} ] && exit 1; exit 0 ;;
esac
exit 0
`
  );
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh
echo "$*" >> ${dockerLog}
case "$2" in
  exec) [ -f ${sweeping} ] || exit 1; cat ${sweeping}; exit 0 ;;
  up) [ -f ${buildFail} ] && exit 1; exit 0 ;;
esac
exit 0
`
  );
  chmodSync(join(bin, 'git'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);

  const flag = (path: string, contents = '') => writeFileSync(path, contents);
  const read = (path: string): string[] => {
    try {
      return readFileSync(path, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  const run = async (): Promise<number> => {
    const proc = Bun.spawn(['sh', SCRIPT], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DEPLOY_REPO: dir,
        DEPLOY_STATE_DIR: state,
        SWEEP_MARKER: '/data/schedule/sweeping',
        DEPLOY_ONCE: '1',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return proc.exited;
  };

  return {
    run,
    flag,
    target,
    ancestor,
    fetchFail,
    mergeFail,
    buildFail,
    sweeping,
    builds: () => read(dockerLog).filter((line) => line.startsWith('compose up')),
    merges: () => read(gitLog).filter((line) => line.startsWith('merge ')),
    deployed: () => (existsSync(join(state, 'deployed')) ? readFileSync(join(state, 'deployed'), 'utf8').trim() : null),
  };
}

const now = () => String(Math.floor(Date.now() / 1000));

// The happy path, and the reason the ref exists: what CI proved is what runs.
test('a new commit on the green ref is fast-forwarded to and rebuilt', async () => {
  const s = stage();
  expect(await s.run()).toBe(0);

  expect(s.merges()).toEqual(['merge --ff-only --quiet cafe1234']);
  expect(s.builds().length).toBe(1);
  expect(s.deployed()).toBe('cafe1234');
});

// Polling every five minutes means most passes have nothing to do, and a rebuild
// per pass would restart the pipeline container twelve times an hour.
test('a pass with nothing new rebuilds nothing', async () => {
  const s = stage();
  await s.run();
  await s.run();

  expect(s.builds().length).toBe(1);
});

// Recording a commit the build never delivered would leave the server serving
// the old image and reporting itself current — silence is the failure mode that
// matters here, so the sha is written only after `up` returns.
test('a failed build is not recorded, so the next pass retries the same commit', async () => {
  const s = stage();
  s.flag(s.buildFail);
  await s.run();
  expect(s.deployed()).toBeNull();

  await s.run();
  expect(s.builds().length).toBe(2);
});

// `docker compose up` recreates the pipeline container, and a scoring stage
// killed halfway has already been billed for tokens it will never write.
test('a sweep in flight holds the deploy back', async () => {
  const s = stage();
  s.flag(s.sweeping, now());
  expect(await s.run()).toBe(0);

  expect(s.builds()).toEqual([]);
  expect(s.deployed()).toBeNull();
});

// A container killed mid-sweep leaves its stamp behind. Deferring on the file's
// presence alone would turn that into a server that never deploys again.
test('a stale sweep marker does not hold the deploy back', async () => {
  const s = stage();
  s.flag(s.sweeping, String(Number(now()) - 7200));
  await s.run();

  expect(s.builds().length).toBe(1);
});

// A `make deploy` got there first. Deploying again would be a rebuild for
// nothing; leaving it unrecorded would log the same line every five minutes.
test('a commit already in the checkout is recorded without a rebuild', async () => {
  const s = stage();
  s.flag(s.ancestor);
  await s.run();

  expect(s.builds()).toEqual([]);
  expect(s.merges()).toEqual([]);
  expect(s.deployed()).toBe('cafe1234');
});

// The checkout has commits of its own — someone debugging on the server. Every
// way out of that is a reset, and a reset would throw their work away.
test('a checkout that cannot fast-forward deploys nothing', async () => {
  const s = stage();
  s.flag(s.mergeFail);
  expect(await s.run()).toBe(0);

  expect(s.builds()).toEqual([]);
  expect(s.deployed()).toBeNull();
});

// The watcher is the only thing keeping the server current, so a network blip
// must cost one poll rather than the loop.
test('a fetch failure costs a pass, not the watcher', async () => {
  const s = stage();
  s.flag(s.fetchFail);
  expect(await s.run()).toBe(0);

  expect(s.builds()).toEqual([]);
});
