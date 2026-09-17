import amqp from 'amqplib';
import axios from 'axios';
import client from 'prom-client';

let channel = null;
let connection = null;
let isConnected = false;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';


import redisClient from '../config/redisClient.js';

const  {connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists} = redisClient;


// Create Prometheus metrics
const requestCounter = new client.Counter({
  name: 'nodejs_log_requests_total',
  help: 'Total log requests published',
  labelNames: ['queue', 'path', 'hostname'],
});

const logSizeGauge = new client.Gauge({
  name: 'nodejs_log_request_size_bytes',
  help: 'Size of each log message in bytes',
  labelNames: ['queue'],
});

const payloadLogMetric = new client.Gauge({
  name: 'nodejs_log_payload_info',
  help: 'Represents fields from payload for observability',
  labelNames: ['queue', 'hostname', 'path', 'user', 'action', 'status', 'payload'],
});

// Register them globally if not already
const register = client.register;
register.registerMetric(requestCounter);
register.registerMetric(logSizeGauge);
register.registerMetric(payloadLogMetric);

const TELEGRAF_URL = process.env.TELEGRAF_URL || 'http://localhost:8186/metrics'; // update as needed






export const connectRabbitMQ = async () => {
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    connection.on('close', () => {
      console.error('🐇🔌 Connection to RabbitMQ closed');
      isConnected = false;
    });

    connection.on('error', (err) => {
      console.error('🐇⚠️ Connection error:', err.message);
      isConnected = false;
    });

    isConnected = true;
    console.log('🐇✅ RabbitMQ connected.');
  } catch (err) {
    console.error('🐇❌ RabbitMQ connection failed:', err.message);
    isConnected = false;
  }
};
export const publishToQueue = async (queueName, data) => { 

  try {
    if (!isConnected || !channel) {
      console.warn('🐇🔄 Attempting reconnect...');
      await connectRabbitMQ();
    }

    if (!channel) {
      console.error('🐇❌ Channel is still null after reconnect');
      return;
    }

    await channel.assertQueue(queueName, { durable: true}); // ensure consistency

    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), {
      persistent: false,
    });

    console.log(`📨 Sent log to RabbitMQ → [${queueName}]`);
  } catch (err) {
    console.error('🐇❌ Error publishing to queue:', err.message);

    // Optional recovery: reset channel & flag for next retry
    channel = null;
    isConnected = false;
  }
};

export const publishToQueueAndTelegraf = async (queueName, data) => {
  try {

    // ========== RabbitMQ Publish ==========
    if (!isConnected || !channel) {
      console.warn('🐇🔄 Attempting reconnect...');
      await connectRabbitMQ();
    }

    if (!channel) {
      console.error('🐇❌ Channel is still null after reconnect');
      return;
    }

    await channel.assertQueue(queueName, { durable: true});

    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), {
      persistent: false,
    });

    console.log(`📨 Sent log to RabbitMQ → [${queueName}]`);

    const register = new client.Registry();

    // Add default system metrics (optional but useful)
    client.collectDefaultMetrics({ register });

    // ========== Telegraf HTTP Push ==========
    try {
      await axios.post(TELEGRAF_URL, data, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('📊 Sent metrics to Telegraf');
    } catch (telegrafErr) {
      console.error('📊❌ Failed to send metrics to Telegraf:', telegrafErr.message);
    }

  } catch (err) {
    console.error('🐇❌ Error publishing to queue:', err.message);

    channel = null;
    isConnected = false;
  }
};

export const publishToQueueAndPrometheus = async (queueName, data, req = null) => {
  try {
    // RabbitMQ
    if (!isConnected || !channel) await connectRabbitMQ();
    if (!channel) return;

    await channel.assertQueue(queueName, { durable: true});
    const payload = Buffer.from(JSON.stringify(data));
    channel.sendToQueue(queueName, payload, { persistent: true});

    // Prometheus
    requestCounter.inc({
      queue: queueName,
      path: req?.path || 'unknown',
      hostname: req?.hostname || 'unknown',
    });

    logSizeGauge.set({ queue: queueName }, payload.length);

    // Inject structured payload values
    payloadLogMetric.set({
      queue: queueName,
      hostname: req?.hostname || 'unknown',
      path: req?.path || 'unknown',
      user: data?.user || 'none',
      action: data?.action || 'none',
      status: data?.status || 'unknown',
      payload:payload
    }, 1);
  } catch (err) {
    console.error('❌ Error in publishToQueueAndPrometheus:', err.message);
  }
};

export const publishToQueue_Redis_Telegraf = async (queueName, data) => {

    try {
    if (!isConnected || !channel) {
      console.warn('🐇🔄 Attempting reconnect...');
      await connectRabbitMQ();
    }

    if (!channel) {
      console.error('🐇❌ Channel is still null after reconnect');
      return;
    }

    await channel.assertQueue(queueName, { durable: true}); // ensure consistency

    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), {
      persistent: false,
    });

    cacheSet(queueName, data);

    console.log(`📨 Sent log to RabbitMQ → [${queueName}]`);
  } catch (err) {
    console.error('🐇❌ Error publishing to queue:', err.message);

    // Optional recovery: reset channel & flag for next retry
    channel = null;
    isConnected = false;
  }

}