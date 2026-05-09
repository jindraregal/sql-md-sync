import crypto from 'crypto';

const MAX_SLUG_LEN = 50;

function transliterate(s: string): string {
  // NFKD decomposes accented characters; strip the combining diacritical marks
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function shortHash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 6);
}

export function makeSlug(value: unknown): string {
  if (value === null || value === undefined) return 'row';
  const str = transliterate(String(value)).toLowerCase();
  const slug = str
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN);
  return slug || 'row';
}

/**
 * Padding width per spec §4.3: ceil(log10(max_id)) + 1, minimum 4.
 */
export function padWidth(maxId: number): number {
  if (!Number.isFinite(maxId) || maxId < 1) return 4;
  return Math.max(4, Math.ceil(Math.log10(maxId)) + 1);
}

export function buildFilename(index: number, slug: string, width = 4): string {
  const padded = String(index).padStart(width, '0');
  return `${padded}-${slug}.md`;
}

/**
 * Return a unique slug. On collision, appends a short hash derived from
 * sourceValue (typically the primary key) rather than a bare numeric suffix.
 */
export function uniqueSlug(base: string, used: Set<string>, sourceValue?: unknown): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  // Collision: append short hash of source value for a stable, readable suffix
  const hashSrc = sourceValue !== undefined ? String(sourceValue) : base;
  const withHash = `${base}-${shortHash(hashSrc)}`;
  if (!used.has(withHash)) {
    used.add(withHash);
    return withHash;
  }
  // Extremely rare (hash collision): fall back to numeric suffix
  let n = 2;
  while (used.has(`${withHash}-${n}`)) n++;
  const fallback = `${withHash}-${n}`;
  used.add(fallback);
  return fallback;
}
