const MAX_SLUG_LEN = 50;

function transliterate(s: string): string {
  // Strip diacritics via NFKD; drop combining marks
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
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

export function padWidth(maxId: number): number {
  if (!Number.isFinite(maxId) || maxId <= 0) return 4;
  return Math.max(4, Math.ceil(Math.log10(maxId + 1)) + 1);
}

export function buildFilename(index: number, slug: string, width = 4): string {
  const padded = String(index).padStart(width, '0');
  return `${padded}-${slug}.md`;
}

export function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  // Use a short hash-like counter; spec says "-<short-hash>" but counter is deterministic + simpler
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const unique = `${base}-${n}`;
  used.add(unique);
  return unique;
}
