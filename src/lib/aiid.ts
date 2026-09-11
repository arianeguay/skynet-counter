// The AIID trend page counts real-world AI incidents in absolute terms, unlike
// the five gauges: no divisor, no keyword score, no per-domain calibration. This
// module holds the parts of that pipeline that are pure functions over data
// already in hand, so they are testable without a network call or a sqlite file
// (`src/lib/db.ts` holds the two thin readers that open the database).

export interface AiidIncident {
  incidentId: number;
  date: string;
  title: string;
}

// AIID backfills past years continuously as new reports come in, so the most
// recent stretch always reads artificially low while that backfill is still
// happening: not because incidents stopped, but because reporting on them
// hasn't caught up yet. Roughly six months, named in days so the cutoff is a
// point in time rather than "this calendar year".
export const AIID_HOLDBACK_DAYS = 183;

export interface YearCount {
  year: number;
  count: number;
}

// Excludes anything inside the holdback window, then groups what remains by
// year. `date` is an ISO string (`YYYY-MM-DD...`), so its first four characters
// are the year without needing a full Date parse.
export function yearlyIncidentCounts(rows: Pick<AiidIncident, 'date'>[], now = Date.now()): YearCount[] {
  const cutoff = new Date(now - AIID_HOLDBACK_DAYS * 864e5).toISOString();
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.date >= cutoff) continue;
    const year = Number(row.date.slice(0, 4));
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, count]) => ({ year, count }));
}

// A minimal RFC4180 row splitter: quoted fields may carry commas, quotes
// (doubled) and newlines, which AIID's export uses for its JSON-ish `reports`
// and free-text `description`/`title` columns. Rows are already newline-joined
// by the caller once quote state is tracked, so this returns whole records
// (each an array of fields) rather than being called once per input line.
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // skip; \n (below) ends the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// Columns are located by header name rather than position, so a reordered
// export (AIID has added columns before) doesn't silently misalign `date` and
// `title`.
export function parseIncidentsCsv(csv: string): AiidIncident[] {
  const rows = parseCsvRows(csv);
  const header = rows[0];
  if (!header) return [];

  const idCol = header.indexOf('incident_id');
  const dateCol = header.indexOf('date');
  const titleCol = header.indexOf('title');
  if (idCol < 0 || dateCol < 0 || titleCol < 0) {
    throw new Error(
      `aiid: incidents.csv is missing an expected column (incident_id/date/title): ${header.join(',')}`
    );
  }

  const incidents: AiidIncident[] = [];
  for (const row of rows.slice(1)) {
    const incidentId = Number(row[idCol]);
    const date = row[dateCol];
    const title = row[titleCol];
    if (!Number.isFinite(incidentId) || !date) continue;
    incidents.push({ incidentId, date, title: title ?? '' });
  }
  return incidents;
}

// AIID's RSS description ends with a citation like
// `(https://incidentdatabase.ai/cite/1684#7927)`: the incident ID it names,
// regardless of which of that incident's reports the item itself is about.
export function extractCiteIncidentId(text: string): number | null {
  const m = text.match(/\/cite\/(\d+)/);
  return m ? Number(m[1]) : null;
}
