export function makeSlug(value: unknown): string {
  const str = String(value ?? '');
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'row';
}

export function buildFilename(index: number, slug: string): string {
  const padded = String(index).padStart(4, '0');
  return `${padded}-${slug}.md`;
}

export function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const unique = `${base}-${n}`;
  used.add(unique);
  return unique;
}
