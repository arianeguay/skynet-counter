import { describe, expect, test } from 'bun:test';
import { AIID_HOLDBACK_DAYS, extractCiteIncidentId, parseIncidentsCsv, yearlyIncidentCounts } from './aiid';

describe('yearlyIncidentCounts', () => {
  const now = Date.parse('2026-09-11T00:00:00.000Z');

  test('groups by year', () => {
    const rows = [{ date: '2020-01-01' }, { date: '2020-12-31' }, { date: '2021-06-15' }];
    expect(yearlyIncidentCounts(rows, now)).toEqual([
      { year: 2020, count: 2 },
      { year: 2021, count: 1 },
    ]);
  });

  test('excludes anything inside the trailing holdback window', () => {
    const insideWindow = new Date(now - (AIID_HOLDBACK_DAYS - 1) * 864e5).toISOString();
    expect(yearlyIncidentCounts([{ date: insideWindow }], now)).toEqual([]);
  });

  test('keeps a row exactly at the holdback boundary or older', () => {
    const justOutside = new Date(now - (AIID_HOLDBACK_DAYS + 1) * 864e5).toISOString();
    const outsideYear = Number(justOutside.slice(0, 4));
    expect(yearlyIncidentCounts([{ date: justOutside }], now)).toEqual([{ year: outsideYear, count: 1 }]);
  });

  // A date-only string (what the backfill stores) must compare correctly
  // against the full-ISO cutoff. A raw string compare would have kept this
  // row, since '2026-03-11' sorts as "less than" '2026-03-11T14:32:...' only
  // because it's a shorter prefix of it, not because it's actually earlier.
  test('a date-only row on the same calendar day as the cutoff is excluded', () => {
    const cutoffInstant = now - AIID_HOLDBACK_DAYS * 864e5;
    const sameDayDateOnly = new Date(cutoffInstant + 12 * 3_600_000).toISOString().slice(0, 10);
    expect(yearlyIncidentCounts([{ date: sameDayDateOnly }], now)).toEqual([]);
  });

  test('empty input yields no years', () => {
    expect(yearlyIncidentCounts([], now)).toEqual([]);
  });
});

describe('parseIncidentsCsv', () => {
  test('parses a well-formed export with quoted fields containing commas', () => {
    const csv =
      '_id,incident_id,date,reports,description,title\n' +
      'ObjectId(1),1,2015-05-19,"[2,3,4]","a description, with a comma",A Title\n' +
      'ObjectId(2),23,2017-11-08,"[242,243]","quoted ""nested"" text",Another Title\n';

    expect(parseIncidentsCsv(csv)).toEqual([
      { incidentId: 1, date: '2015-05-19', title: 'A Title' },
      { incidentId: 23, date: '2017-11-08', title: 'Another Title' },
    ]);
  });

  test('locates columns by header name, not position', () => {
    const csv = 'title,incident_id,date\nSwapped Order,42,2019-01-01\n';
    expect(parseIncidentsCsv(csv)).toEqual([{ incidentId: 42, date: '2019-01-01', title: 'Swapped Order' }]);
  });

  test('throws when an expected column is missing', () => {
    const csv = 'incident_id,title\n1,Foo\n';
    expect(() => parseIncidentsCsv(csv)).toThrow();
  });

  test('skips a row with a non-numeric incident_id', () => {
    const csv = 'incident_id,date,title\nnot-a-number,2020-01-01,Foo\n';
    expect(parseIncidentsCsv(csv)).toEqual([]);
  });

  test('empty csv yields no rows', () => {
    expect(parseIncidentsCsv('')).toEqual([]);
  });
});

describe('extractCiteIncidentId', () => {
  test('reads the incident id out of a citation url', () => {
    expect(
      extractCiteIncidentId('Some report text ... (https://incidentdatabase.ai/cite/1684#7927)')
    ).toBe(1684);
  });

  test('returns null when no citation is present', () => {
    expect(extractCiteIncidentId('No citation here at all.')).toBeNull();
  });

  // The description can mention a different incident in prose before its own
  // closing citation; the report belongs to the last one, not the first.
  test('takes the last citation, not the first, when the description mentions more than one', () => {
    expect(
      extractCiteIncidentId(
        'Similar to the case at (https://incidentdatabase.ai/cite/999#111), this report ... (https://incidentdatabase.ai/cite/1684#7927)'
      )
    ).toBe(1684);
  });
});
