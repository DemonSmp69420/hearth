/**
 * M5.3 app-lock PIN (§12): PBKDF2-SHA256 via WebCrypto. The PIN itself is
 * never stored anywhere — only a salted derived hash lives in the local
 * database settings table, so exports/backups never contain the secret.
 */
export interface PinRecord {
  salt: string;
  hash: string;
  iterations: number;
}

const ITERATIONS = 120_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPin(pin: string, salt: string, iterations = ITERATIONS): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations } as Pbkdf2Params,
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export async function makePinRecord(pin: string): Promise<PinRecord> {
  const salt = randomSalt();
  return { salt, hash: await hashPin(pin, salt), iterations: ITERATIONS };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  const hash = await hashPin(pin, record.salt, record.iterations);
  if (hash.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) {
    diff |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
  }
  return diff === 0;
}
