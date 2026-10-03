const HEX = '0123456789abcdef';

function cryptoRand(): number {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 256;
}

/**
 * RFC 9562 UUIDv7: 48-bit big-endian unix-ms timestamp + 74 random bits.
 * App-side generation keeps inserts idempotent and index-friendly (D-008).
 * Timestamp and RNG are injectable for deterministic tests.
 */
export function uuidv7(now: number = Date.now(), rand: () => number = cryptoRand): string {
  const bytes = new Array<number>(16);
  let ts = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  for (let i = 6; i < 16; i++) {
    bytes[i] = Math.floor(rand() * 256) & 0xff;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.map((b) => HEX[b >> 4]! + HEX[b & 0x0f]!).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
