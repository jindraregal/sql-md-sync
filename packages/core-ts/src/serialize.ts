import matter from 'gray-matter';
import type { ColumnInfo, RowData } from './types.js';

export const NULL_MARKER = '<!-- null -->';
const ESCAPE_PREFIX = '\\#';

// Strict section heading: `# identifier` at column zero, nothing else
const HEADING_RE = /^# ([A-Za-z_][A-Za-z0-9_]*)$/;

// YAML 1.2 keywords that must not appear as bare plain scalars
const YAML_KEYWORDS = new Set(['null', 'true', 'false', '~', 'yes', 'no', 'on', 'off']);

// ─── YAML frontmatter serializer ──────────────────────────────────────────────

function needsBlockScalar(s: string): boolean {
  // Spec §4.4: block scalar when string contains :, #, quotes, or newlines
  return /[:#"'\n\r]/.test(s);
}

function looksLikeNumber(s: string): boolean {
  return (
    /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ||
    /^[-+]?0x[0-9a-fA-F]+$/i.test(s) ||
    /^[-+]?0o[0-7]+$/.test(s)
  );
}

function needsForceQuote(s: string): boolean {
  return (
    YAML_KEYWORDS.has(s.toLowerCase()) ||
    looksLikeNumber(s) ||
    /^[{[!%|>@`]/.test(s) ||
    s.startsWith(' ') ||
    s.endsWith(' ')
  );
}

function buildBlockScalar(s: string): string {
  // Determine trailing-newline count to pick the right chomp indicator.
  let trailingNl = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === '\n'; i--) trailingNl++;

  // |- strip (no trailing nl), | clip (one trailing nl), |+ keep (many)
  const chomp = trailingNl === 0 ? '-' : trailingNl === 1 ? '' : '+';
  const base = trailingNl > 0 ? s.slice(0, -trailingNl) : s;
  const body = base
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
  return `|${chomp}\n${body}`;
}

function serializeString(s: string): string {
  if (s === '') return "''";
  if (needsBlockScalar(s)) return buildBlockScalar(s);
  if (needsForceQuote(s)) {
    // Only backslash needs escaping in a double-quoted scalar here
    // (# and : are already handled by block scalar above)
    return `"${s.replace(/\\/g, '\\\\')}"`;
  }
  return s;
}

function serializeYamlValue(val: unknown): string {
  if (val === null || val === undefined) return '~';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return '.nan';
    if (!Number.isFinite(val)) return val > 0 ? '.inf' : '-.inf';
    return String(val); // JS toString() = shortest round-trip representation
  }
  if (typeof val === 'string') return serializeString(val);
  if (Array.isArray(val)) {
    const items = val.map((v) => {
      if (typeof v === 'string') {
        // Flow-sequence strings: double-quote anything that could confuse parsers
        if (/[,[\]{}:#"'\n\r]/.test(v) || v === '' || YAML_KEYWORDS.has(v.toLowerCase())) {
          return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        }
        return v;
      }
      return serializeYamlValue(v);
    });
    return `[${items.join(', ')}]`;
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>).map(
      ([k, v]) => `${k}: ${serializeYamlValue(v)}`
    );
    return `{${entries.join(', ')}}`;
  }
  return serializeString(String(val));
}

function buildFrontmatter(orderedKeys: string[], row: RowData): string {
  const parts: string[] = ['---'];
  for (const key of orderedKeys) {
    const raw = row[key];
    if (raw === null || raw === undefined) continue;
    const val = raw instanceof Buffer ? raw.toString('base64') : raw;
    const serialized = serializeYamlValue(val);
    parts.push(`${key}: ${serialized}`);
  }
  parts.push('---');
  // join with \n — block scalar strings already contain embedded \n, which is preserved
  return parts.join('\n') + '\n';
}

// ─── Body section helpers ─────────────────────────────────────────────────────

function escapeBodyContent(content: string): string {
  // Spec §4.4: escape lines that look like section headings with ESCAPE_PREFIX
  return content
    .split('\n')
    .map((line) => (HEADING_RE.test(line) ? `${ESCAPE_PREFIX} ${line.slice(2)}` : line))
    .join('\n');
}

function unescapeBodyLine(line: string): string {
  const m = /^\\# (.+)$/.exec(line);
  return m ? `# ${m[1]}` : line;
}

function orderFrontmatterKeys(row: RowData, columnOrder: string[], bodySet: Set<string>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const col of columnOrder) {
    seen.add(col);
    if (!bodySet.has(col)) keys.push(col);
  }
  // Append extra row keys not in schema column order (defensive)
  for (const k of Object.keys(row)) {
    if (!seen.has(k) && !bodySet.has(k)) keys.push(k);
  }
  return keys;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isLargeText(value: unknown, threshold: number): boolean {
  if (typeof value !== 'string') return false;
  return value.length > threshold || value.includes('\n');
}

export function detectBodyColumns(
  rows: RowData[],
  columns: ColumnInfo[],
  threshold: number
): string[] {
  const textCols = columns.filter(
    (c) =>
      c.type.toUpperCase().includes('TEXT') ||
      c.type === '' ||
      c.type.toUpperCase().includes('CLOB')
  );
  const body = new Set<string>();
  for (const row of rows) {
    for (const col of textCols) {
      if (isLargeText(row[col.name], threshold)) {
        body.add(col.name);
      }
    }
  }
  // Preserve schema column order for determinism
  return columns.map((c) => c.name).filter((n) => body.has(n));
}

export function rowToMarkdown(row: RowData, bodyColumns: string[], columnOrder?: string[]): string {
  const bodySet = new Set(bodyColumns);
  const order = columnOrder ?? Object.keys(row);
  const fmKeys = orderFrontmatterKeys(row, order, bodySet);
  const frontmatter = buildFrontmatter(fmKeys, row);

  // Body sections in schema column order
  const orderedBody = [...order.filter((c) => bodySet.has(c))];
  for (const col of bodyColumns) {
    if (!orderedBody.includes(col)) orderedBody.push(col);
  }

  const sections: string[] = [];
  for (const col of orderedBody) {
    const v = row[col];
    if (v === null || v === undefined) {
      // Spec §4.2: NULL body → explicit null marker
      sections.push(`# ${col}\n\n${NULL_MARKER}`);
    } else if (v === '') {
      // Empty string → heading with no body (distinguishable from NULL)
      sections.push(`# ${col}`);
    } else {
      const content = escapeBodyContent(String(v));
      sections.push(`# ${col}\n\n${content}`);
    }
  }

  if (sections.length === 0) return frontmatter;
  return `${frontmatter}\n${sections.join('\n\n')}\n`;
}

export function markdownToRow(content: string): RowData {
  const parsed = matter(content);
  const row: RowData = { ...(parsed.data as Record<string, unknown>) };

  const body = parsed.content;
  if (!body) return row;

  const lines = body.split('\n');
  let currentCol: string | null = null;
  const colLines: Record<string, string[]> = {};

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      currentCol = m[1];
      if (!(currentCol in colLines)) colLines[currentCol] = [];
    } else if (currentCol !== null) {
      colLines[currentCol].push(unescapeBodyLine(line));
    }
  }

  for (const [col, colLineArr] of Object.entries(colLines)) {
    let arr = colLineArr;
    // Drop the single blank line immediately after the heading
    if (arr.length > 0 && arr[0] === '') arr = arr.slice(1);
    // Drop a single trailing blank line
    if (arr.length > 0 && arr[arr.length - 1] === '') arr = arr.slice(0, -1);
    const joined = arr.join('\n');
    // Spec §4.2: explicit null marker → NULL; otherwise use as-is (empty string stays empty)
    row[col] = joined === NULL_MARKER ? null : joined;
  }

  return row;
}
