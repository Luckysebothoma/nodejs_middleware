import Redis from 'ioredis';
import { redisHost, redisPort } from "../keys.js";

const redis = new Redis({
  host: redisHost,
  port: redisPort,
});

export default redis;
