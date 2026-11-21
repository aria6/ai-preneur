import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt (memory-hard, no native addon).
 * Parameters follow OWASP guidance (N=2^15, r=8, p=1 ≈ 32 MiB per hash).
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<salt base64>$<key base64>` — parameters are
 * embedded so they can be raised later; `needsRehash` upgrades hashes on login.
 */
const CURRENT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;
const MAX_N = 2 ** 20;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC so visually identical Unicode passwords hash identically.
    scryptCallback(password.normalize('NFKC'), salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const key = Buffer.from(parts[5] ?? '', 'base64');

  const validN = Number.isInteger(N) && N > 1 && N <= MAX_N && (N & (N - 1)) === 0;
  const validRp = Number.isInteger(r) && r >= 1 && r <= 32 && Number.isInteger(p) && p >= 1 && p <= 16;
  if (!validN || !validRp || salt.length < 16 || key.length < 32) return null;

  return { N, r, p, salt, key };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(CURRENT.saltLength);
  const key = await deriveKey(password, salt, CURRENT.keyLength, {
    N: CURRENT.N,
    r: CURRENT.r,
    p: CURRENT.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return ['scrypt', CURRENT.N, CURRENT.r, CURRENT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Constant-time comparison. Returns false (never throws) for malformed hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const actual = await deriveKey(password, parsed.salt, parsed.key.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return timingSafeEqual(actual, parsed.key);
}

export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return (
    !parsed ||
    parsed.N !== CURRENT.N ||
    parsed.r !== CURRENT.r ||
    parsed.p !== CURRENT.p ||
    parsed.key.length !== CURRENT.keyLength
  );
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same work as a real verification. Called when the account does not
 * exist so response timing does not reveal which emails are registered.
 */
export async function burnPasswordVerification(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPassword(password, await dummyHash);
}
