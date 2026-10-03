import { describe, expect, it } from 'vitest';
import { mockTransport } from './mock';

describe('mockTransport', () => {
  it('round-trips secrets through the in-memory store', async () => {
    await mockTransport.invoke('secrets_set', { account: 'p1', secret: 'sk-test' });
    expect(await mockTransport.invoke<string>('secrets_get', { account: 'p1' })).toBe('sk-test');
    await mockTransport.invoke('secrets_delete', { account: 'p1' });
    expect(await mockTransport.invoke<string | null>('secrets_get', { account: 'p1' })).toBeNull();
  });

  it('rejects unknown commands', async () => {
    await expect(mockTransport.invoke('nope')).rejects.toThrow(/no handler/);
  });
});
