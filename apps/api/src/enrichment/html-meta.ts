/** What we keep from a company's homepage. Everything here is untrusted text from a stranger's website. */
export interface PageMeta {
  title: string | null;
  description: string | null;
  /** The first ~2000 characters of visible text. */
  text: string;
}

const MAX_TEXT = 2000;
const MAX_FIELD = 300;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ' ';
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * Makes text safe to store and to show: no control characters (NUL would make
 * Postgres jsonb fail), no lone surrogates, one space between words.
 */
export function clean(text: string, max: number): string {
  return text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** A tag's attribute value, quoted either way. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match?.[1] ?? match?.[2];
}

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^<>]*>/gi) ?? []) {
    const name = (attribute(tag, 'name') ?? attribute(tag, 'property'))?.toLowerCase();
    if (name !== key) continue;
    const value = clean(decode(attribute(tag, 'content') ?? ''), MAX_FIELD);
    if (value) return value;
  }
  return null;
}

/** Blocks whose contents are not visible text: [opening, closing]. */
const BLOCKS: [string, string][] = [
  ['<!--', '-->'],
  ['<script', '</script'],
  ['<style', '</style'],
  ['<noscript', '</noscript'],
  ['<svg', '</svg'],
  ['<head', '</head'],
  ['<template', '</template'],
];

/**
 * Removes those blocks in ONE pass with indexOf. A regex with a lazy gap would
 * rescan to the end of the page for every unclosed tag, which a hostile page
 * could use to keep us busy. An unclosed block drops the rest of the page.
 */
function stripBlocks(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let at = 0;
  while (at < html.length) {
    let start = -1;
    let closing = '';
    for (const [open, close] of BLOCKS) {
      const found = lower.indexOf(open, at);
      if (found !== -1 && (start === -1 || found < start)) {
        start = found;
        closing = close;
      }
    }
    if (start === -1) return out + html.slice(at);
    out += `${html.slice(at, start)} `;
    const close = lower.indexOf(closing, start + 1);
    if (close === -1) return out;
    const end = html.indexOf('>', close);
    at = end === -1 ? html.length : end + 1;
  }
  return out;
}

/** Title, description and visible text of an HTML page, without an HTML parser (we only read a few well-known tags). */
export function extractPageMeta(html: string): PageMeta {
  const title = /<title\b[^<>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  // [^<>]* never crosses another "<", so stray brackets cannot make this quadratic.
  const text = stripBlocks(html).replace(/<[^<>]*>/g, ' ');
  return {
    title: title ? clean(decode(title), MAX_FIELD) || null : null,
    description: metaContent(html, 'description') ?? metaContent(html, 'og:description'),
    text: clean(decode(text), MAX_TEXT),
  };
}
