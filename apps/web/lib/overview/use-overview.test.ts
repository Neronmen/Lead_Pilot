import { describe, expect, it } from 'vitest';
import { toDuration } from './use-overview';

describe('toDuration', () => {
  it.each([
    [0.2, { unit: 'seconds', n: 1 }],
    [45, { unit: 'seconds', n: 45 }],
    [89, { unit: 'seconds', n: 89 }],
    [120, { unit: 'minutes', n: 2 }],
    [3600, { unit: 'minutes', n: 60 }],
    [2 * 3600, { unit: 'hours', n: 2 }],
    [40 * 3600, { unit: 'days', n: 2 }],
  ])('%s seconds reads as %j', (seconds, expected) => {
    expect(toDuration(seconds)).toEqual(expected);
  });
});
