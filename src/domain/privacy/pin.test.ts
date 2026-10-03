import { describe, expect, it } from 'vitest';
import { hashPin, makePinRecord, randomSalt, verifyPin } from './pin';

describe('pin (M5.3 app lock)', () => {
  it('round-trips a correct PIN and rejects wrong ones', async () => {
    const rec = await makePinRecord('1234');
    expect(await verifyPin('1234', rec)).toBe(true);
    expect(await verifyPin('4321', rec)).toBe(false);
    expect(await verifyPin('12345', rec)).toBe(false);
    expect(await verifyPin('', rec)).toBe(false);
  });

  it('salts are unique, so equal PINs never share a hash', async () => {
    const a = await makePinRecord('9999');
    const b = await makePinRecord('9999');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('produces a 64-char hex hash with a 16-byte hex salt', async () => {
    const rec = await makePinRecord('0');
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(rec.iterations).toBeGreaterThan(0);
  });

  it('verifies against an explicit salt+iterations hash', async () => {
    const salt = randomSalt();
    const hash = await hashPin('hunter2', salt, 1000);
    expect(await verifyPin('hunter2', { salt, hash, iterations: 1000 })).toBe(true);
    expect(await verifyPin('Hunter2', { salt, hash, iterations: 1000 })).toBe(false);
  });
});
