// The university picker only accepts schools from this list, so a profile can't
// hold a made-up name. The list (src/data/universities.json, ~10k schools) is
// trimmed from github.com/Hipo/university-domains-list (MIT licence) and loaded
// on first use so it stays out of the main bundle.

export interface University {
  name: string;
  /** ISO 3166 alpha-2 country code, e.g. "US". */
  country: string;
}

export interface Entry extends University {
  words: string[];
  /** Initials of the significant words: "University of California, Los Angeles" → "ucla". */
  initials: string;
  lower: string;
}

const MINOR_WORDS = new Set(['of', 'the', 'and', 'at', 'in', 'for', 'de', 'la', '&', '-']);

function tokens(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9&]+/).filter(Boolean);
}

/** Rows are `[name, countryCode]`, the shape of src/data/universities.json. */
export function indexUniversities(rows: [string, string][]): Entry[] {
  return rows.map(([name, country]) => {
    const words = tokens(name);
    return {
      name,
      country,
      words,
      initials: words.filter(w => !MINOR_WORDS.has(w)).map(w => w[0]).join(''),
      lower: name.toLowerCase(),
    };
  });
}

let loading: Promise<Entry[]> | null = null;

export function loadUniversities(): Promise<Entry[]> {
  loading ??= import('../data/universities.json')
    .then(mod => indexUniversities(mod.default as [string, string][]))
    .catch(err => { loading = null; throw err; });
  return loading;
}

/**
 * Best matches for what the student has typed so far; empty for an empty query.
 * `homeCountry` breaks ties between same-initial schools ("MIT" is also Madras
 * Institute of Technology), since the list has no measure of prominence.
 */
export function searchUniversities(list: Entry[], query: string, homeCountry?: string, limit = 8): University[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  const whole = q.join('');
  const phrase = query.trim().toLowerCase();

  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of list) {
    // Every typed word has to land somewhere: as the start of a word in the
    // name, or inside the initials ("uc" in "ucb" for "UC Berkeley").
    const matches = q.every(t => entry.words.some(w => w.startsWith(t)) || (t.length > 1 && entry.initials.includes(t)));
    if (!matches) continue;

    let score = 0;
    if (entry.initials === whole) score += 100;             // "ucla", "mit", "nyu"
    if (entry.lower.startsWith(phrase)) score += 50;
    else if (entry.lower.includes(phrase)) score += 20;
    if (entry.country === homeCountry) score += 10;
    score -= entry.name.length / 100;                       // prefer the shorter, main campus name
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ entry }) => ({ name: entry.name, country: entry.country }));
}

/** The country the browser is set to, e.g. "US" for en-US; undefined if it doesn't say. */
export function browserCountry(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const region = tag.split('-')[1];
    if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  }
  return undefined;
}

const countryNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export function countryName(code: string): string {
  try { return countryNames?.of(code) ?? code; } catch { return code; }
}
