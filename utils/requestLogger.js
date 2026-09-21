import { publishToQueue_Redis_Telegraf } from '../utils/rabbitMQPublisher.js';
import { matchEndpointLabel } from './endpointLogMap.js';
import { buildTelegrafPayload } from '../data_transformer/telegraf_json.js';
import TimeUtils from '../utils/Time.js';

const { formattedDate, getLongTime } = TimeUtils;

const UNKNOWN_LABEL = '🗂️ Unknown Endpoint';

const shouldPublish = (mode) => mode === 'full' || mode === 'both';

const resolveLabel = (req, manualLabel) =>
  matchEndpointLabel(req.method, req.path) || manualLabel || UNKNOWN_LABEL;

const getRequestMeta = (req) => ({
  correlationId: req.headers['x-correlation-id'] || `req-${Date.now()}`,
  userId: req.headers['x-user-id'] || 'anonymous',
  authToken: req.headers['authorization'] || '',
  clientIp: req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip,
  userAgent: req.headers['user-agent'] || '',
  cfRay: req.headers['cf-ray'] || '',
});

const elapsedMs = (startHrTime) => {
  const [sec, nano] = process.hrtime(startHrTime);
  return +(sec * 1000 + nano / 1e6).toFixed(3);
};

// Logging must never break (or crash after) the actual response.
const publishAll = async (messages) => {
  try {
    for (const [routingKey, payload] of messages) {
      await publishToQueue_Redis_Telegraf(routingKey, payload);
    }
  } catch (err) {
    console.error('Log publish failed:', err.message);
  }
};

export const logRequestDetails = async (req, manualLabel = '', mode = 'both') => {

  //skip /metrics endpoint to avoid logging metrics requests
  if (req.path === '/metrics') {
    return;
  }
  const startHrTime = process.hrtime();
  const label = resolveLabel(req, manualLabel);
  const { correlationId, userId, authToken, clientIp, userAgent, cfRay } = getRequestMeta(req);

  const shortLog = {
    time: formattedDate(new Date()),
    label,
    method: req.method,
    url: req.url,
    protocol: req.protocol,
    correlationId,
    userId,
    authToken,
    clientIp,
    userAgent,
    cfRay,
  };

  const fullLog = {
    ...shortLog,
    originalUrl: req.originalUrl,
    path: req.path,
    ip: req.ip,
    hostname: req.hostname,
    params: req.params,
    query: req.query,
    body: req.body,
    headers: req.headers,
  };

  if (!shouldPublish(mode)) return;

  const telegrafLog = buildTelegrafPayload({
    timestamp: getLongTime(new Date()),
    measurement: 'http_logs',
    tags: {
      method: req.method,
      path: req.path,
      label,
      fullLog,
    },
    fields: {
      duration_ms: elapsedMs(startHrTime),
      ip: req.ip,
      hostname: req.hostname,
    },
  });

  const key = `${req.hostname}${req.path}`;
  await publishAll([
    [`logs.request.telegraf.${key}`, telegrafLog],
    [`logs.request.${key}`, fullLog],
    [`logs.request.log.${key}`, shortLog],
  ]);
};

export const logResponseDetails = async (req, res, payload, manualLabel = '', status = 500, mode = 'both') => {
  const startHrTime = process.hrtime();
  const now = new Date();
  const isoTimestamp = now.toISOString();
  const label = resolveLabel(req, manualLabel);
  const { correlationId } = getRequestMeta(req);

  const data = payload || [];
  const success = status === 200;

  const apiResponse = success
    ? { success: true, message: 'Success', data: payload }
    : { success: false, message: 'Failed', data: JSON.stringify(payload) };

  res.status(status).send(apiResponse);

  if (!shouldPublish(mode)) return;

  const durationMs = elapsedMs(startHrTime);
  const payloadString = JSON.stringify(payload);

  const logData = {
    method: req.method,
    url: req.originalUrl,
    status: success,
    message: apiResponse.message,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    timestamp: isoTimestamp,
    data: payloadString,
  };

  const telegrafResponse = buildTelegrafPayload({
    measurement: 'http_responses',
    tags: {
      correlationId,
      method: req.method,
      path: req.path,
      label,
      status: success,
    },
    fields: {
      success: success ? 1 : 0,
      message_length: apiResponse.message.length,
      response_size: Buffer.byteLength(JSON.stringify(apiResponse)),
      data_length: payloadString.length,
      data_payload: data,
      payload: [`correlationId:${correlationId}`, payloadString],
      duration_ms: durationMs,
      payloadSize: payload?.length ?? -1,
      duration: durationMs,
      label,
      time: isoTimestamp,
      hostname: req.hostname,
    },
    timestamp: now * 1e6,
  });

  const key = `${req.hostname}${req.path}`;
  await publishAll([
    [`logs.response.log.${key}`, logData],
    [`logs.response.telegraf.${key}`, telegrafResponse],
    [
      `logs.responses.${key}`,
      {
        time: isoTimestamp,
        method: req.method,
        path: req.path,
        label,
        status,
        responseMeta: success,
        durationMs,
        payload: data,
      },
    ],
  ]);
};