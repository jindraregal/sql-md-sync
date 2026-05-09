import matter from 'gray-matter';
import yaml from 'js-yaml';
import type { ColumnInfo, RowData } from './types.js';

const HEADING_RE = /^#\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

function isLargeText(value: unknown, threshold: number): boolean {
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
  // Preserve schema column order so output is deterministic
  return columns.map((c) => c.name).filter((n) => body.has(n));
}

function orderFrontmatter(
  row: RowData,
  columnOrder: string[],
  bodySet: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const col of columnOrder) {
    seen.add(col);
    if (bodySet.has(col)) continue;
    const val = row[col];
    if (val === null || val === undefined) continue;
    out[col] = val instanceof Buffer ? val.toString('base64') : val;
  }
  // Append extra row keys not in the schema column order
  for (const [k, v] of Object.entries(row)) {
    if (seen.has(k) || bodySet.has(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = v instanceof Buffer ? v.toString('base64') : v;
  }
  return out;
}

export function rowToMarkdown(
  row: RowData,
  bodyColumns: string[],
  columnOrder?: string[]
): string {
  const bodySet = new Set(bodyColumns);
  const order = columnOrder ?? Object.keys(row);
  const frontmatter = orderFrontmatter(row, order, bodySet);

  const fmYaml = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  });

  const sections: string[] = [];
  // Emit body sections in schema column order
  const orderedBody = order.filter((c) => bodySet.has(c));
  for (const col of bodyColumns) {
    if (!orderedBody.includes(col)) orderedBody.push(col);
  }
  for (const col of orderedBody) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    sections.push(`# ${col}\n\n${String(v)}`);
  }

  const fmBlock = `---\n${fmYaml}---\n`;
  if (sections.length === 0) return fmBlock;
  return `${fmBlock}\n${sections.join('\n\n')}\n`;
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
      colLines[currentCol].push(line);
    }
  }

  for (const [col, colLineArr] of Object.entries(colLines)) {
    let arr = colLineArr;
    // Drop the single blank line that follows the heading
    if (arr.length > 0 && arr[0] === '') arr = arr.slice(1);
    // Drop a single trailing blank line that precedes the next heading or EOF
    if (arr.length > 0 && arr[arr.length - 1] === '') arr = arr.slice(0, -1);
    row[col] = arr.join('\n');
  }

  return row;
}
