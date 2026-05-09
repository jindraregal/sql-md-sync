import matter from 'gray-matter';
import type { ColumnInfo, RowData } from './types.js';

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
    (c) => c.type.toUpperCase().includes('TEXT') || c.type === '' || c.type.toUpperCase().includes('BLOB')
  );
  const body = new Set<string>();
  for (const row of rows) {
    for (const col of textCols) {
      if (isLargeText(row[col.name], threshold)) {
        body.add(col.name);
      }
    }
  }
  return Array.from(body);
}

export function rowToMarkdown(
  row: RowData,
  bodyColumns: string[]
): string {
  const bodySet = new Set(bodyColumns);
  const frontmatter: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(row)) {
    if (val === null || val === undefined) continue;
    if (!bodySet.has(key)) {
      frontmatter[key] = val;
    }
  }

  const sections: string[] = [];
  for (const col of bodyColumns) {
    if (row[col] !== null && row[col] !== undefined) {
      sections.push(`# ${col}\n\n${String(row[col])}`);
    }
  }

  const body = sections.join('\n\n');
  return matter.stringify(body, frontmatter);
}

export function markdownToRow(content: string): RowData {
  const parsed = matter(content);
  const row: RowData = { ...parsed.data };

  // Parse body sections (# column_name followed by content)
  const bodyText = parsed.content.trimStart();
  if (bodyText) {
    const sectionRegex = /^#\s+(.+?)$([\s\S]*?)(?=^#\s|\s*$)/gm;
    // Simpler approach: split on lines starting with "# "
    const lines = bodyText.split('\n');
    let currentCol: string | null = null;
    const colLines: Record<string, string[]> = {};

    for (const line of lines) {
      const headingMatch = /^#\s+(.+)$/.exec(line);
      if (headingMatch) {
        currentCol = headingMatch[1].trim();
        colLines[currentCol] = [];
      } else if (currentCol !== null) {
        colLines[currentCol].push(line);
      }
    }

    void sectionRegex; // suppress unused warning
    for (const [col, colLineArr] of Object.entries(colLines)) {
      row[col] = colLineArr.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    }
  }

  return row;
}
