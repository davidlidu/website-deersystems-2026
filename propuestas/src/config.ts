import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const env = process.env;
const production = env.NODE_ENV === 'production';

export const PORT = Number(env.PORT ?? 3000);
/** URL pública sin barra final, p. ej. https://propuestas.deersystems.net */
export const PUBLIC_URL = (env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '');
export const SECURE = PUBLIC_URL.startsWith('https://');
export const DATA_DIR = resolve(env.DATA_DIR ?? './data');
export const MAX_UPLOAD_BYTES = Number(env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;
/** Límite del contenido descomprimido de un .zip. */
export const MAX_UNPACKED_BYTES = MAX_UPLOAD_BYTES * 4;

/** Superusuario: siempre tiene acceso y es el único que gestiona otros correos. */
export const SUPERADMIN_EMAIL = (env.SUPERADMIN_EMAIL ?? 'ceo@deersystems.net').trim().toLowerCase();
export const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID ?? '';
export const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET ?? '';

/** A dónde va quien entra a la raíz del subdominio. */
export const HOME_URL = env.HOME_URL ?? 'https://deersystems.net';

/** Entrar sin Google como superusuario. Solo en local y fuera de producción. */
export const DEV_LOGIN =
  !production && env.DEV_LOGIN === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(PUBLIC_URL);

if (production && !env.SESSION_SECRET) {
  console.error('Falta SESSION_SECRET.');
  process.exit(1);
}
export const SESSION_SECRET = env.SESSION_SECRET ?? randomBytes(32).toString('hex');
