import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import zlib, { brotliCompressSync, gzipSync } from 'node:zlib';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ───────── Compresión ─────────
// Los archivos de la app (JS, CSS, HTML) se comprimen una vez y quedan en memoria; el JSON grande, al vuelo.

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/;

/** br si el navegador lo acepta, si no gzip; null = sin compresión. */
function pickEncoding(req: IncomingMessage | undefined): 'br' | 'gzip' | null {
  const accept = String(req?.headers['accept-encoding'] ?? '');
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

function compress(data: Buffer, encoding: 'br' | 'gzip', fast: boolean): Buffer {
  return encoding === 'br'
    ? brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: fast ? 4 : 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
    : gzipSync(data, { level: fast ? 6 : 9 });
}

const compressedCache = new Map<string, Buffer>();

export function json(res: ServerResponse, status: number, body: unknown): void {
  const raw = Buffer.from(JSON.stringify(body));
  const encoding = raw.length > 1024 ? pickEncoding(res.req) : null;
  const data = encoding ? compress(raw, encoding, true) : raw;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding',
    'Content-Length': data.length,
    ...(encoding ? { 'Content-Encoding': encoding } : {}),
  });
  res.end(data);
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, `El archivo supera el máximo de ${Math.round(limit / 1024 / 1024)} MB.`);
    if (Number(req.headers['content-length'] ?? 0) > limit) return reject(tooBig());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        reject(tooBig());
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  try {
    const body = JSON.parse((await readBody(req, limit)).toString() || '{}');
    if (body && typeof body === 'object') return body;
  } catch (err) {
    if (err instanceof HttpError) throw err;
  }
  throw new HttpError(400, 'JSON no válido.');
}

/** Sirve un archivo con ETag y rangos. Devuelve false si no existe. */
export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  headers: Record<string, string>,
  status = 200,
): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;

  const etag = `"${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`;
  const base = {
    'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    ...headers,
  };
  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, base);
    res.end();
    return true;
  }

  // Texto comprimible y sin pedido de rango: se envía comprimido (y se recuerda, porque los archivos de la app no cambian).
  const encoding = COMPRESSIBLE.test(base['Content-Type']) && !req.headers.range && info.size > 1024 && info.size < 8 * 1024 * 1024 ? pickEncoding(req) : null;
  if (encoding) {
    const key = `${path}|${etag}|${encoding}`;
    let data = compressedCache.get(key);
    if (!data) {
      data = compress(await readFile(path), encoding, false);
      if (compressedCache.size > 200) compressedCache.clear();
      compressedCache.set(key, data);
    }
    res.writeHead(status, { ...base, 'Content-Encoding': encoding, Vary: 'Accept-Encoding', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  }

  let start = 0;
  let end = info.size - 1;
  const range = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(info.size - Number(range[2]), 0);
    }
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      res.end();
      return true;
    }
    status = 206;
    Object.assign(base, { 'Content-Range': `bytes ${start}-${end}/${info.size}` });
  }

  res.writeHead(status, { ...base, 'Content-Length': info.size === 0 ? 0 : end - start + 1 });
  if (req.method === 'HEAD' || info.size === 0) res.end();
  else createReadStream(path, { start, end }).pipe(res);
  return true;
}

