/** The first `{ ... }` of a text, ignoring a code fence around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object');
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

/** The start of the current month in UTC: the AI cost limit is per calendar month. */
export const monthStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
