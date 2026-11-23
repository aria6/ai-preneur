import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for social media credentials (access tokens).
 *
 * - Key: 32 bytes, base64, from SOCIAL_CREDENTIALS_KEY (`openssl rand -base64 32`).
 * - Format: `v1:<iv>:<auth tag>:<ciphertext>` (base64 parts), random 12-byte IV per value.
 * - The ciphertext is bound to its owner (`batchId:platform`) through GCM additional
 *   authenticated data, so a value copied into another row fails to decrypt.
 */
export class CredentialsKeyMissingError extends Error {
  constructor() {
    super('SOCIAL_CREDENTIALS_KEY is not configured');
    this.name = 'CredentialsKeyMissingError';
  }
}

export interface CredentialsCipher {
  readonly configured: boolean;
  encrypt(value: unknown, context: string): string;
  decrypt(payload: string, context: string): unknown;
}

export function parseCredentialsKey(base64Key: string | undefined): Buffer | null {
  if (!base64Key) return null;
  const key = Buffer.from(base64Key.trim(), 'base64');
  return key.length === 32 ? key : null;
}

export function createCredentialsCipher(key: Buffer | null): CredentialsCipher {
  return {
    configured: key !== null,

    encrypt(value, context) {
      if (!key) throw new CredentialsKeyMissingError();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        'v1',
        iv.toString('base64'),
        tag.toString('base64'),
        ciphertext.toString('base64'),
      ].join(':');
    },

    decrypt(payload, context) {
      if (!key) throw new CredentialsKeyMissingError();
      const [version, ivB64, tagB64, dataB64] = payload.split(':');
      if (version !== 'v1' || !ivB64 || !tagB64 || dataB64 === undefined) {
        throw new Error('Unsupported credentials payload');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plaintext) as unknown;
    },
  };
}

export function credentialsContext(batchId: string, platform: string): string {
  return `sm-account:${batchId}:${platform}`;
}
