import { describe, expect, it } from 'vitest';
import { uuidv7 } from './id';

// Deterministic LCG so tests never depend on platform RNG.
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('encodes the unix-ms timestamp in the first 48 bits', () => {
    const ms = 1727900000123;
    const u = uuidv7(ms, rand);
    const restored = parseInt(u.replace(/-/g, '').slice(0, 12), 16);
    expect(restored).toBe(ms);
  });

  it('sets version 7 and the RFC variant nibbles', () => {
    const u = uuidv7(1727900000123, rand);
    expect(u[14]).toBe('7');
    expect(u[19]).toMatch(/[89ab]/);
    expect(u).toMatch(UUID_RE);
  });

  it('produces unique ids at a fixed timestamp', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1727900000123, rand)));
    expect(ids.size).toBe(1000);
  });

  it('sorts lexicographically in time order', () => {
    const early = uuidv7(1727900000000, rand);
    const late = uuidv7(1727900009999, rand);
    expect(early < late).toBe(true);
  });
});
