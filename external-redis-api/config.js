const path = require('path');

module.exports = {
  protocol: 'http', // or 'http'
  host: 'sweety-api-redis-container', // Docker container name resolves on the same network
  port: 3000, // Internal container port

  cert: path.resolve('/certs/cert.crt'),
  key: path.resolve('/certs/key.key'),
  ca: null, // Optional if using self-signed or internal CA
  timeout: 5000,
};
