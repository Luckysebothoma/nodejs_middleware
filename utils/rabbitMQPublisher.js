// utils/rabbitMQPublisher.js

import amqp from 'amqplib';

let channel = null;
let isConnected = false;
const RABBITMQ_URL = 'amqp://guest:guest@localhost:5672'; // or use ENV

export const connectRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    isConnected = true;
    console.log('🐇✅ RabbitMQ connected.');
  } catch (err) {
    console.error('🐇❌ RabbitMQ connection failed:', err.message);
  }
};

export const publishToQueue = async (queueName, data) => {
  if (!isConnected) await connectRabbitMQ();
  if (!channel) return;

  try {
    await channel.assertQueue(queueName, { durable: true });
    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), {
      persistent: true,
    });
    console.log(`📨 Sent log to RabbitMQ → [${queueName}]`);
  } catch (err) {
    console.error('🐇❌ Error publishing to queue:', err.message);
  }
};
