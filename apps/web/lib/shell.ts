/**
 * Up to two capital letters for an avatar: "Northstar Growth" -> "NG",
 * "daniel.park@x.com" -> "DP". Only letters and digits count (so "(Acme) & Co"
 * gives "AC"), and a letter is taken whole, not half of an emoji.
 */
export function initials(text: string): string {
  const parts = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0]!.toLocaleUpperCase().slice(0, 1));
  return letters.join('') || '?';
}

/** True when `pathname` is `href` or a page below it ("/leads/123" is under "/leads"). */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
