import amqp from 'amqplib';

let channel = null;
let connection = null;
let isConnected = false;

const RABBITMQ_URL = 'amqp://admin:admin@rabbitmq:5672';

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

    await channel.assertQueue(queueName, { durable: true }); // ensure consistency

    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), {
      persistent: true,
    });

    console.log(`📨 Sent log to RabbitMQ → [${queueName}]`);
  } catch (err) {
    console.error('🐇❌ Error publishing to queue:', err.message);

    // Optional recovery: reset channel & flag for next retry
    channel = null;
    isConnected = false;
  }
};
