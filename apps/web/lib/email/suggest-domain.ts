import { hasRealTld } from '@leadpilot/shared';

/** The providers people use most; a near miss of one of these is a likely typo. */
const COMMON_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com.vn',
  'outlook.com.vn',
];

/**
 * Real domains that sit one letter from a common one (`mail.com` is not a
 * typo of `gmail.com`). They get no suggestion.
 */
const REAL_NEAR_MISSES = new Set([
  'mail.com',
  'email.com',
  'msn.com',
  'me.com',
  'mac.com',
  'gmx.com',
  'hey.com',
  'pm.me',
  'zoho.com',
  'fastmail.com',
  'yandex.com',
  'protonmail.ch',
]);

/** Endings a mistyped ending is most likely meant to be. */
const COMMON_ENDINGS = ['com', 'net', 'org', 'vn', 'co', 'io'];

/** Edit distance where swapping two neighbouring letters (`gmial`) counts as one change. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * "Did you mean gmail.com?": the domain this address was probably meant to
 * have, or null when it looks fine. Two cases:
 * - the domain is one or two edits from a common provider (`gmial.com`);
 * - the ending is not a real one and one edit from a common ending
 *   (`acme.con` -> `acme.com`).
 * It only suggests; the person decides. No network, no dictionary of people.
 */
export function suggestEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain.includes('.') || domain.length < 4) return null;
  if (COMMON_DOMAINS.includes(domain) || REAL_NEAR_MISSES.has(domain)) return null;

  let best: { domain: string; distance: number } | null = null;
  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    // One edit for short names, two for long ones: "yaho.com" yes, "ya.com" no.
    const allowed = candidate.length >= 10 ? 2 : 1;
    if (distance <= allowed && (!best || distance < best.distance))
      best = { domain: candidate, distance };
  }
  if (best) return best.domain;

  // An ending that does not exist: fix it if a common ending is one edit away.
  const dot = domain.lastIndexOf('.');
  const name = domain.slice(0, dot);
  const ending = domain.slice(dot + 1);
  if (name && !hasRealTld(`x@${domain}`)) {
    const fix = COMMON_ENDINGS.find((common) => editDistance(ending, common) <= 1);
    if (fix) return `${name}.${fix}`;
  }
  return null;
}

/** The address with its domain replaced by the suggestion. */
export function applySuggestion(email: string, suggestion: string): string {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, at + 1)}${suggestion}`;
}
