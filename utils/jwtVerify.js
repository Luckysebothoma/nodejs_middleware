import jwt from 'jsonwebtoken';
 
export const verifyJWT = async (token) => {
  // Here you'd fetch JWKS keys from Auth0/Okta and verify
  // Simplified example:
  return jwt.decode(token, { complete: true }).payload;
};
