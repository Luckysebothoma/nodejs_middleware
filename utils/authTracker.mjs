import crypto from "crypto";
import pkg from "pg";
const { Pool } = pkg;


const pool = new Pool({
  user: process.env.PG_USER || "postgres",
  host: process.env.PG_HOST || "localhost",
  database: process.env.PG_DB || "authdb",
  password: process.env.PG_PASS || "password",
  port: process.env.PG_PORT || 5432,
});

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function trackToken(token, decoded) {
  const tokenHash = hashToken(token);
  const issuedAt = new Date(decoded.iat * 1000);
  const expiresAt = new Date(decoded.exp * 1000);
  const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

  const permissions = Array.isArray(decoded.permissions)
    ? decoded.permissions
    : [];

  const query = `
    INSERT INTO auth_tokens (token_hash, user_id, issuer, audience, issued_at, expires_at, ttl_seconds, source, permissions)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'redis', $8)
    ON CONFLICT (token_hash)
    DO UPDATE SET
      last_seen = NOW(),
      ttl_seconds = $7,
      permissions = $8,
      updated_at = NOW()
  `;

  try {
    await pool.query(query, [
      tokenHash,
      decoded.sub,
      decoded.iss,
      Array.isArray(decoded.aud) ? decoded.aud.join(",") : decoded.aud,
      issuedAt,
      expiresAt,
      ttl,
      permissions
    ]);
    console.log(`[${new Date().toISOString()}] 📦 Token + permissions tracked in PostgreSQL`);
  } catch (err) {
    console.error("❌ Error tracking token:", err.message);
  }
}
export async function hasPermission(token, permission) {
  const tokenHash = hashToken(token);

  const { rows } = await pool.query(
    "SELECT permissions FROM auth_tokens WHERE token_hash = $1",
    [tokenHash]
  );

  if (rows.length === 0) return false;

  return rows[0].permissions.includes(permission);
}
