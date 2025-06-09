const axios = require('axios');
const https = require('https');
const fs = require('fs');
const config = require('./config');

let httpsAgent = null;

if (config.protocol === 'https') {
  httpsAgent = new https.Agent({
    cert: fs.readFileSync(config.cert),
    key: fs.readFileSync(config.key),
    rejectUnauthorized: false, // Set to true if using trusted CA
  });
}

const api = axios.create({
  baseURL: `${config.protocol}://${config.host}:${config.port}`,
  timeout: config.timeout,
  httpsAgent: httpsAgent,
});

module.exports = api;

