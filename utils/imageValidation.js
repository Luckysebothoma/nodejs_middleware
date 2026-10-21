// utils/imageValidation.js
// Pure helpers (no I/O) for the product-image store.
import { createHash } from 'node:crypto';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB (matches the SQL CHECK constraint)
export const ALLOWED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Detects the real image type from the file's leading bytes.
 * The client-supplied Content-Type / file extension is never trusted.
 * SVG is deliberately NOT allowed (scriptable content).
 * @param {Buffer|Uint8Array} buf
 * @returns {'image/jpeg'|'image/png'|'image/webp'|null}
 */
export function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  // WebP: "RIFF" <size> "WEBP"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

/**
 * Validates a product id taken from a URL. Returns it as a canonical digit string
 * (safe to pass to a BIGINT parameter) or null when invalid.
 */
export function parseProductId(raw) {
  const s = String(raw ?? '').trim();
  return /^[1-9][0-9]{0,15}$/.test(s) ? s : null;
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Keeps only a harmless base name for the audit column (never used as a path). */
export function sanitizeOriginalName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255) || null;
}

/** Does an If-None-Match header value match this ETag? (handles lists, weak tags and "*") */
export function etagMatches(headerValue, etag) {
  if (!headerValue) return false;
  const v = String(headerValue).trim();
  if (v === '*') return true;
  return v.split(',').map(s => s.trim().replace(/^W\//, '')).includes(etag);
}
