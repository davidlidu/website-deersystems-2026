import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ENCRYPTION_KEY } from './config.ts';

const key = createHash('sha256').update(`deersystems-secrets:${ENCRYPTION_KEY}`).digest();

/** AES-256-GCM → "iv.tag.datos" en base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

/** Devuelve null si el valor no se puede descifrar (p. ej. cambió ENCRYPTION_KEY). */
export function decrypt(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** "sk-or-v1-abc…xyz" → "sk-or…xyz", para mostrar qué clave está guardada sin revelarla. */
export function mask(secret: string | null): string | null {
  if (!secret) return null;
  return secret.length <= 10 ? '••••' : `${secret.slice(0, 5)}…${secret.slice(-4)}`;
}
