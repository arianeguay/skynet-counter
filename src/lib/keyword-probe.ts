import { normalizeText } from './keywords';

// The measurement "Picking a domain's keywords" in CLAUDE.md describes, as code.
//
// That method is written down in three places and was run by hand every time:
// fetch the candidates, hydrate them the way `dedupe` does, run `matchedKeywords`
// over the result and read the per-keyword hit counts. A keyword firing on 40%+
// of articles is measuring the beat rather than the story; a keyword firing zero
// times is dead weight. Both thresholds are the issue history's, not new ones —
// STU-1218 threw `data center` out of `environment` on the first and
// STU-1217 found thirteen of fifteen `domotique` keywords dead on the second.
//
// The counting lives here rather than in `scripts/keyword-probe.ts` for the
// reason the counter formula lives in `counter.ts` rather than in `aggregate.ts`:
// the script needs a database and the proof does not.

// The share of a corpus above which a term is measuring the beat instead of the
// story. Dead weight as severity — and, read the other way, exactly what makes a
// good subject term (STU-1291). Read the same number twice, for the two purposes.
export const BEAT_RATIO = 0.4;

export interface ProbeRow {
  title: string;
  summary: string;
  score: number;
}

export interface TermStat {
  term: string;
  /** Articles whose text contains the term. */
  hits: number;
  /** `hits` as a share of the corpus. */
  ratio: number;
  /** Mean score, under the live table, of the articles the term lands in. */
  meanScore: number;
  /**
   * Hits on articles the live table scores at zero — the only column that says
   * whether a candidate would reach stories the counter currently cannot see,
   * rather than piling weight onto ones it already counts.
   */
  rescues: number;
}

function textOf(row: ProbeRow): string {
  return normalizeText(`${row.title} ${row.summary}`);
}

/**
 * Per-term hit counts over a corpus, sorted by hits descending.
 *
 * `rows` are already gated: a domain with a `subject` list filters through
 * `mentionsSubject` first, because an off-subject row scores zero by
 * construction and would otherwise dominate every candidate's `rescues`.
 */
export function probeTerms(rows: ProbeRow[], terms: readonly string[]): TermStat[] {
  const haystacks = rows.map(textOf);
  return terms
    .map((term) => {
      const needle = normalizeText(term);
      const hit = rows.filter((_, i) => needle !== '' && haystacks[i]!.includes(needle));
      const total = hit.reduce((t, r) => t + r.score, 0);
      return {
        term,
        hits: hit.length,
        ratio: rows.length === 0 ? 0 : hit.length / rows.length,
        meanScore: hit.length === 0 ? 0 : total / hit.length,
        rescues: hit.filter((r) => r.score === 0).length,
      };
    })
    .sort((a, b) => b.hits - a.hits || a.term.localeCompare(b.term));
}

export type Verdict = 'dead' | 'beat' | 'ok';

export function verdictOf(stat: TermStat): Verdict {
  if (stat.hits === 0) return 'dead';
  if (stat.ratio >= BEAT_RATIO) return 'beat';
  return 'ok';
}

/**
 * Existing keywords a candidate collides with under substring matching, in
 * either direction.
 *
 * The matcher scans by substring, so a candidate containing a keyword pays that
 * keyword's weight twice on the same article, and one contained by a keyword
 * makes the longer entry unreachable as a distinct signal. This is the
 * no-keyword-is-a-substring-of-another rule the table already keeps by hand
 * (`vulnerabilit` carries the stem rather than a second plural entry), reported
 * before a candidate is adopted rather than discovered on a sweep.
 */
export function collisions(term: string, weights: Record<string, number>): string[] {
  const needle = normalizeText(term);
  if (!needle) return [];
  return Object.keys(weights).filter((k) => {
    const other = normalizeText(k);
    if (other === needle) return false;
    return needle.includes(other) || other.includes(needle);
  });
}
