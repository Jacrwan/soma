// Kept free of imports so tests can load it without the Supabase client.

/**
 * A time range the student typed ("from now until 12:30 am", "11pm to 1",
 * "until 11 pm"), read straight from their message. The model kept turning
 * stated times into a length ("60 minutes somewhere after 11:23") and getting
 * the arithmetic wrong, so the app reads them itself.
 *
 * Minutes are counted from the day's midnight; `end` passes 1440 when the
 * range runs past midnight. Returns nothing for anything ambiguous: "3 to 5"
 * alone could be chapters, so a range needs "now", noon/midnight, a colon,
 * am/pm, or "until"/"till" to count as clock times.
 */
export function statedRange(text: string, nowMinute: number): { start: number; end: number; fromNow: boolean } | undefined {
  const TOKEN = String.raw`(now|noon|midnight|\d{1,2}(?::[0-5]\d)?\s*(?:[ap]\.?\s?m\.?)?)`;
  // A token must stand alone: "4.1-4.9" and "HW 4: KK-4" are not times.
  const range = new RegExp(String.raw`(?:^|[\s(,])(?:from\s+)?${TOKEN}(?![\d.:])\s*(-|–|—|\bto\b|\buntil\b|\btill\b|\btil\b)\s*${TOKEN}(?![\d.:])`, 'i');
  const lone = new RegExp(String.raw`(?:^|[\s(,])(until|till|til)\s+${TOKEN}(?![\d.:])`, 'i');
  let startTok: string, endTok: string, connector: string;
  const m = text.match(range);
  if (m) { [, startTok, connector, endTok] = m; }
  else {
    const l = text.match(lone);
    // "until 11 pm" on its own starts now only when the student says now.
    if (!l || !/\bnow\b/i.test(text)) return undefined;
    [startTok, connector, endTok] = ['now', l[1], l[2]];
  }
  const clue = (t: string) => /now|noon|midnight|:|[ap]\.?\s?m/i.test(t);
  if (!/until|till|til/i.test(connector) && !clue(startTok) && !clue(endTok)) return undefined;

  type Read = { m: number; exact: boolean };
  const read = (tok: string, isEnd: boolean): Read | undefined => {
    const t = tok.toLowerCase().replace(/[\s.]/g, '');
    if (t === 'now') return { m: nowMinute, exact: true };
    if (t === 'noon') return { m: 720, exact: true };
    if (t === 'midnight') return { m: isEnd ? 1440 : 0, exact: true };
    const p = t.match(/^(\d{1,2})(?::(\d\d))?(am|pm)?$/);
    if (!p) return undefined;
    let h = Number(p[1]); const mi = Number(p[2] ?? 0);
    if (mi > 59) return undefined;
    if (p[3]) {
      if (h < 1 || h > 12) return undefined;
      h = (h % 12) + (p[3] === 'pm' ? 12 : 0);
      return { m: h * 60 + mi, exact: true };
    }
    if (h > 23) return undefined;
    if (h === 0 || h >= 13) return { m: h * 60 + mi, exact: true };   // 24-hour
    if (h === 12) return { m: 720 + mi, exact: true };                 // "12" is noon
    return { m: h * 60 + mi, exact: false };
  };
  const s = read(startTok, false), e = read(endTok, true);
  if (!s || !e) return undefined;

  // A start without am/pm: with a definite end, the nearest time before it
  // ("2-4pm" is 2 PM, "11 to 1am" is 11 PM); otherwise the next time it comes round.
  let start = s.m;
  if (!s.exact && e.exact) {
    const fits = [e.m, e.m + 1440].flatMap(target => [s.m, s.m + 720].filter(c => c < target && target - c <= 720));
    start = fits.length ? Math.max(...fits.filter(c => c < 1440)) : s.m;
  } else if (!s.exact) start = [s.m, s.m + 720].find(c => c >= nowMinute - 15) ?? s.m;
  // An end is the first time after the start: "11pm until 1" is 1 AM.
  let end = e.m;
  if (!e.exact) end = [e.m, e.m + 720, e.m + 1440, e.m + 2160].find(c => c > start) ?? e.m;
  else while (end <= start) end += 1440;
  if (end - start < 5 || end - start > 720) return undefined;
  return { start, end, fromNow: startTok.toLowerCase() === 'now' };
}
