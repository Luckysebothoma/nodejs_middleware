const Redis = require('ioredis');
const keys = require("../keys");

const redis = new Redis({
  host: keys.redisHost,
  port: keys.redisPort,
});

module.exports = redis;
