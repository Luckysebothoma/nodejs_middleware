import { pgQuery } from './postgres.js';
import { hashToken, getTTL } from '../utils/tokenUtils.js';

export const trackToken = async ({ token, decoded, source, ip, path }) => {


  console.log(`token:${token }\n  decoded:${JSON.stringify(decoded)} \n source:${source} \n ip:${ip} \n path:${path}` )


  if(decoded==0){

       await pgQuery(`
  INSERT INTO token_access_logs (token_hash, user_id, request_path, ip_address)
  VALUES ($1, $2, $3, $4)
`, [token, 'no token', path || null, ip || null]);


  }else{

  const tokenHash = hashToken(token);
  const issuedAt = new Date(decoded.iat * 1000);
  const expiresAt = new Date(decoded.exp * 1000);
  const ttl = getTTL(decoded.exp);
  const permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];
  const audience = Array.isArray(decoded.aud) ? decoded.aud.join(",") : decoded.aud;


      await pgQuery(
    `
    INSERT INTO token_tracking (
      token_hash, user_id, issuer, audience, issued_at, expires_at,
      ttl_seconds, source, permissions, ip_address, request_path,
      last_seen, created_at, updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9::jsonb, $10, $11,
      now(), now(), now()
    )
    ON CONFLICT (token_hash)
    DO UPDATE SET
      last_seen = now(),
      updated_at = now(),
      ip_address = EXCLUDED.ip_address,
      request_path = EXCLUDED.request_path
    `,
    [
      tokenHash,
      decoded.sub,
      decoded.iss,
      audience,
      issuedAt,
      expiresAt,
      ttl,
      source,
      JSON.stringify(permissions),
      ip || null,
      path || null
    ],
    'trackToken'
  );

   await pgQuery(`
  INSERT INTO token_access_logs (token_hash, user_id, request_path, ip_address)
  VALUES ($1, $2, $3, $4)
`, [tokenHash, decoded.sub, path || null, ip || null]);


  }


};
