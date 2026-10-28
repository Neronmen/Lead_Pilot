export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** The delimiter a spreadsheet export used: a comma, a semicolon (many locales) or a tab. */
function delimiterOf(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * A small, careful CSV reader (RFC 4180): quoted cells may hold the delimiter, quotes ("") and line
 * breaks; a leading byte-order mark and Windows line endings are fine. The first line is the header.
 * Empty cells and fully empty lines are dropped, so a row only carries what it actually says.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const delimiter = delimiterOf(text);
  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      table.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    table.push(row);
  }

  const [head, ...body] = table.filter((cells) => cells.some((c) => c.trim() !== ''));
  const headers = (head ?? []).map((h) => h.trim());
  const rows = body.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = (cells[index] ?? '').trim();
      if (header !== '' && value !== '') record[header] = value;
    });
    return record;
  });
  return {
    headers: headers.filter((h) => h !== ''),
    rows: rows.filter((r) => Object.keys(r).length > 0),
  };
}

const squash = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** True when some column looks like an email or a phone number: without one, no row can become a lead. */
export function hasContactColumn(headers: string[]): boolean {
  return headers.some((h) =>
    ['email', 'emailaddress', 'phone', 'phonenumber', 'mobile'].includes(squash(h)),
  );
}

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
