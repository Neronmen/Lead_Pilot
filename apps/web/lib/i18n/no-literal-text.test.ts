import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every string a person reads goes through i18n. ESLint's jsx-no-literals
 * catches text between tags; this catches the attributes it does not.
 * `app/status` and `app/dev` are internal pages (CLAUDE.md) and exempt.
 */
const root = join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.next', 'e2e', 'messages']);
const EXEMPT = ['app/status', 'app/dev', 'components/ui'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (SKIP.has(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

const LITERAL_ATTR =
  /\b(aria-label|aria-description|placeholder|title|alt)=("[^"{]*[A-Za-z][^"]*"|'[^'{]*[A-Za-z][^']*')/g;

describe('user-facing attributes', () => {
  const files = sources(root)
    .map((file) => ({ file, rel: relative(root, file).replaceAll('\\', '/') }))
    .filter(({ rel }) => !EXEMPT.some((prefix) => rel.startsWith(prefix)));

  it('scans some files', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it.each(files.map(({ rel, file }) => [rel, file] as const))(
    '%s has no literal aria-label, placeholder, title or alt',
    (_rel, file) => {
      const found = [...readFileSync(file, 'utf8').matchAll(LITERAL_ATTR)].map((m) => m[0]);
      expect(found).toEqual([]);
    },
  );
});
