import { pgQuery } from './postgres.js';
import { hashToken, getTTL } from '../utils/tokenUtils.js';

/**
 * Tracks or updates a JWT access token and records a general access log.
 */
export const trackToken = async ({ token, decoded, source = 'redis', ip = null, path = null }) => {
  if (!token || !decoded || decoded === 0) {
    console.warn('[Postgres] ⚠️ trackToken called without valid token or decoded payload');
    return;
  }

  try {
    const tokenHash = hashToken(token);
    const issuedAt = new Date(decoded.iat * 1000);
    const expiresAt = new Date(decoded.exp * 1000);
    const ttl = getTTL(decoded.exp);
    const permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];
    const audience = Array.isArray(decoded.aud) ? decoded.aud.join(",") : (decoded.aud || '');

    // 1. Upsert into auth_tokens table matching your schema
    const tokenSql = `
      INSERT INTO auth_tokens 
        (token_hash, user_id, issuer, audience, issued_at, expires_at, ttl_seconds, source, permissions)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (token_hash)
      DO UPDATE SET
        last_seen = NOW(),
        ttl_seconds = EXCLUDED.ttl_seconds,
        permissions = EXCLUDED.permissions,
        source = EXCLUDED.source,
        updated_at = NOW();
    `;

    await pgQuery(tokenSql, [
      tokenHash,
      decoded.sub || 'unknown_sub',
      decoded.iss || null,
      audience,
      issuedAt,
      expiresAt,
      ttl,
      source,
      JSON.stringify(permissions) // Stringify for safe JSONB column casting
    ], 'trackToken');

    // 2. Log individual request access event (if your table expects ip/path tracking)
    // Note: Make sure your 'token_access_logs' table exists in the database if you use this query.
    const accessLogSql = `
      INSERT INTO token_access_logs (token_hash, user_id, request_path, ip_address)
      VALUES ($1, $2, $3, $4)
    `;
    
    await pgQuery(accessLogSql, [
      tokenHash, 
      decoded.sub || 'unknown_sub', 
      path || null, 
      ip || null
    ], 'trackTokenAccess');

    // Observability log metric for scraping/monitoring
    console.log(`[OBSERVE] token_tracked{user="${decoded.sub}", source="${source}", ttl=${ttl}} 1`);

  } catch (err) {
    console.error('[Postgres] ❌ trackToken execution error:', err.message);
  }
};