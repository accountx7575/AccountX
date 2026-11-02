/**
 * Nullish-string normalization at document boundaries (PBS-128).
 * Legacy business rows can carry the literal strings 'null'/'undefined' in
 * free-text columns (no String(null) writer exists in repo code — human-side
 * DB cleanup, see PBS-128). These helpers neutralize them at entry so print
 * and preview headers never render the words.
 */
export function cleanMedia(u?: string | null): string | undefined {
  const t = (u ?? '').trim();
  if (!t) return undefined;
  const low = t.toLowerCase();
  if (low === 'null' || low === 'undefined') return undefined;
  return t;
}

export function cleanText(v?: string | null): string {
  const t = (v ?? '').trim();
  if (!t) return '';
  const low = t.toLowerCase();
  if (low === 'null' || low === 'undefined') return '';
  return t;
}
