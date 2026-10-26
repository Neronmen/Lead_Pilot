import { describe, expect, it } from 'vitest';
import { initials, isActive } from './shell';

describe('initials', () => {
  it.each([
    ['Northstar Growth', 'NG'],
    ['Đặng Văn An', 'ĐV'],
    ['daniel.park@northstar.com', 'DP'],
    ['a.b@c.com', 'AB'],
    ['ABC', 'A'],
    ['x', 'X'],
    ['(Acme) & Co', 'AC'],
    ['---', '?'],
    ['', '?'],
    ['ß Straße', 'SS'],
  ])('%s -> %s', (text, expected) => {
    expect(initials(text)).toBe(expected);
  });

  it('never splits an emoji', () => {
    const result = initials('🚀 Rocket');
    expect(result).toBe('R');
    expect(initials('Rocket 😀Team')).toBe('RT');
  });
});

describe('isActive', () => {
  it.each([
    ['/leads', '/leads', true],
    ['/leads/123', '/leads', true],
    ['/leadsx', '/leads', false],
    ['/settings/team', '/settings/team', true],
    ['/settings/team/x', '/settings/team', true],
    ['/settings', '/settings/team', false],
    ['/', '/leads', false],
  ])('%s under %s -> %s', (pathname, href, expected) => {
    expect(isActive(pathname, href)).toBe(expected);
  });
});
