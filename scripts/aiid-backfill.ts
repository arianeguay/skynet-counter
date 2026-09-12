// One-time load of AIID's full history into `aiid_incidents`, for the AIID
// trend page. Distinct from the hourly feed pattern: no Studio pipeline stage,
// no scoring, just a CSV import. Safe to rerun: every row is upserted on
// AIID's own `incident_id`, so a rerun refreshes dates/titles AIID has since
// corrected rather than duplicating rows.
//
// AIID's GraphQL API is origin-gated, so this reads the same weekly database
// snapshot a human would download from https://incidentdatabase.ai/research/snapshots,
// an R2-hosted `backup-<timestamp>.tar.bz2` archive containing (among other
// exports) `mongodump_full_snapshot/incidents.csv`, which carries the
// incident's own `date` field, not a report date.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@/lib/db';
import { parseIncidentsCsv } from '@/lib/aiid';
import { USER_AGENT } from '../.studio/scripts/rss';

const SNAPSHOTS_PAGE = 'https://incidentdatabase.ai/research/snapshots';
const INCIDENTS_CSV_PATH = 'mongodump_full_snapshot/incidents.csv';

function die(message: string): never {
  console.error(`aiid-backfill: ${message}`);
  process.exit(1);
}

async function latestSnapshotUrl(): Promise<string> {
  const res = await fetch(SNAPSHOTS_PAGE, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) die(`snapshots page responded ${res.status}`);
  const html = await res.text();

  // Timestamps are `YYYYMMDDHHMMSS`, which sorts correctly as a plain string,
  // so no date parsing is needed to find the newest one. Anchored inside a
  // quoted attribute value (`"https://...backup-...tar.bz2"`) rather than a
  // bare `[^"]+` before the literal: without that boundary the match can run
  // unbounded across a large quote-sparse stretch of the page (an inline
  // script blob, say) and backtrack character by character looking for the
  // literal, which is quadratic over the page size and burned minutes of CPU
  // on the real page before this was caught.
  const urls = [...html.matchAll(/"(https:\/\/[^"]*backup-\d{14}\.tar\.bz2)"/g)].map((m) => m[1]!);
  if (urls.length === 0) die('found no backup-*.tar.bz2 link on the snapshots page, page format may have changed');
  return urls.sort().at(-1)!;
}

async function downloadTo(url: string, path: string): Promise<void> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) die(`${url} responded ${res.status}`);
  // Not `Bun.write(path, res)`: handing it the Response directly hung
  // indefinitely against the real archive on this Bun version (1.3.14),
  // burning CPU with nothing ever written to disk. Buffering the body first
  // writes the same 111 MB file in under 4 seconds.
  await Bun.write(path, await res.arrayBuffer());
}

// Extracts just the one CSV from the archive rather than unpacking the whole
// 100+ MB tar.bz2 (which also holds a full mongodump) to disk.
async function extractIncidentsCsv(archivePath: string): Promise<string> {
  const proc = Bun.spawn(['tar', '-xjf', archivePath, '-O', INCIDENTS_CSV_PATH], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [csv, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) die(`tar failed extracting ${INCIDENTS_CSV_PATH}: ${stderr.trim()}`);
  return csv;
}

const url = await latestSnapshotUrl();
console.log(`aiid-backfill: downloading ${url}`);

const dir = await mkdtemp(join(tmpdir(), 'aiid-backfill-'));
const archivePath = join(dir, 'backup.tar.bz2');
try {
  await downloadTo(url, archivePath);
  const csv = await extractIncidentsCsv(archivePath);
  const incidents = parseIncidentsCsv(csv);
  if (incidents.length === 0) die('parsed zero incidents from the export, refusing to write nothing over real history');

  const db = openDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO aiid_incidents (incident_id, date, title, ingested_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(incident_id) DO UPDATE SET date = excluded.date, title = excluded.title, ingested_at = excluded.ingested_at`
  );
  db.transaction(() => {
    for (const incident of incidents) upsert.run(incident.incidentId, incident.date, incident.title, now);
  })();
  db.close();

  const years = incidents.map((i) => i.date.slice(0, 4)).sort();
  console.log(`aiid-backfill: loaded ${incidents.length} incidents (${years[0]} to ${years.at(-1)})`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
