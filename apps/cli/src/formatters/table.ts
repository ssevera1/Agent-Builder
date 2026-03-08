/**
 * Table formatter — renders tabular data with aligned columns,
 * borders, and optional ANSI color support.
 */

import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Alignment = 'left' | 'right' | 'center';

export interface TableOptions {
  /** Column alignments. Defaults to 'left' for all columns. */
  alignments?: Alignment[];
  /** Maximum column width before truncation. Defaults to 50. */
  maxColumnWidth?: number;
  /** Whether to show row separator lines. Defaults to false. */
  rowSeparators?: boolean;
  /** Whether to use colored headers. Defaults to true. */
  colorHeaders?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Format data as an aligned text table.
 *
 * @param headers - Column header labels.
 * @param rows - 2D array of cell values.
 * @param options - Formatting options.
 * @returns A formatted table string.
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  options: TableOptions = {},
): string {
  const {
    alignments = [],
    maxColumnWidth = 50,
    rowSeparators = false,
    colorHeaders = true,
  } = options;

  if (headers.length === 0) {
    return '';
  }

  // Truncate cell contents and calculate column widths
  const truncatedHeaders = headers.map((h) => truncate(h, maxColumnWidth));
  const truncatedRows = rows.map((row) =>
    row.map((cell) => truncate(cell, maxColumnWidth)),
  );

  // Determine each column width
  const colWidths = truncatedHeaders.map((h, i) => {
    const cellWidths = truncatedRows.map((row) => stripAnsi(row[i] ?? '').length);
    return Math.max(stripAnsi(h).length, ...cellWidths);
  });

  // Build separator line
  const separator = '+-' + colWidths.map((w) => '-'.repeat(w)).join('-+-') + '-+';

  const lines: string[] = [];

  // Top border
  lines.push(separator);

  // Header row
  const headerCells = truncatedHeaders.map((h, i) => {
    const padded = padCell(h, colWidths[i]!, getAlignment(alignments, i));
    return colorHeaders ? chalk.bold.cyan(padded) : padded;
  });
  lines.push('| ' + headerCells.join(' | ') + ' |');

  // Header separator
  lines.push(separator);

  // Data rows
  for (const row of truncatedRows) {
    const cells = headers.map((_, i) => {
      const value = row[i] ?? '';
      return padCell(value, colWidths[i]!, getAlignment(alignments, i));
    });
    lines.push('| ' + cells.join(' | ') + ' |');

    if (rowSeparators) {
      lines.push(separator);
    }
  }

  // Bottom border (if no row separators, the last row needs one)
  if (!rowSeparators) {
    lines.push(separator);
  }

  return lines.join('\n');
}

/**
 * Format data as a simple compact table without borders.
 */
export function formatCompactTable(
  headers: string[],
  rows: string[][],
): string {
  if (headers.length === 0) return '';

  const colWidths = headers.map((h, i) => {
    const cellWidths = rows.map((row) => stripAnsi(row[i] ?? '').length);
    return Math.max(stripAnsi(h).length, ...cellWidths);
  });

  const lines: string[] = [];

  // Header
  const headerLine = headers
    .map((h, i) => chalk.bold(padCell(h, colWidths[i]!, 'left')))
    .join('  ');
  lines.push(headerLine);

  // Underline
  lines.push(colWidths.map((w) => '-'.repeat(w)).join('  '));

  // Rows
  for (const row of rows) {
    const line = headers
      .map((_, i) => padCell(row[i] ?? '', colWidths[i]!, 'left'))
      .join('  ');
    lines.push(line);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAlignment(alignments: Alignment[], index: number): Alignment {
  return alignments[index] ?? 'left';
}

function padCell(text: string, width: number, alignment: Alignment): string {
  const textWidth = stripAnsi(text).length;
  const padding = Math.max(0, width - textWidth);

  switch (alignment) {
    case 'right':
      return ' '.repeat(padding) + text;
    case 'center': {
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return ' '.repeat(left) + text + ' '.repeat(right);
    }
    case 'left':
    default:
      return text + ' '.repeat(padding);
  }
}

function truncate(text: string, maxWidth: number): string {
  const stripped = stripAnsi(text);
  if (stripped.length <= maxWidth) return text;
  return stripped.slice(0, maxWidth - 3) + '...';
}

/**
 * Strip ANSI escape codes from a string to measure its display width.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
