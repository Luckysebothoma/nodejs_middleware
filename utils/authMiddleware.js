import { verifyJWT } from './jwtVerify.js';
import { trackToken } from '../config/trackToken.js';


export const authMiddleware = async (req, res, next) => {
  try {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!bearer) throw new Error('Missing token');

    const decoded = await verifyJWT(bearer);

    await trackToken({
      token: bearer,
      decoded,
      source: 'api',
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      path: req.originalUrl
    });

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};
