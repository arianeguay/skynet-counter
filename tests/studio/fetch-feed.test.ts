import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// fetch-feed.ts throws on a stage name it has no feed for, and a throw fails the
// whole parallel group. The two lists drifted apart once already, which cost
// every sweep between the rename and the fix.
test('the pipeline declares exactly the feeds fetch-feed.ts defines', () => {
  const feeds = [...readFileSync('.studio/scripts/fetch-feed.ts', 'utf8').matchAll(/^ {2}'([\w-]+)': \{$/gm)].map(
    (m) => m[1]
  );
  const stages = [...readFileSync('.studio/pipelines/skynet-counter.pipeline.yaml', 'utf8').matchAll(
    /^ {6}- name: (fetch-[\w-]+)$/gm
  )].map((m) => m[1]);
  expect(stages.sort()).toEqual([...feeds].sort());
});
