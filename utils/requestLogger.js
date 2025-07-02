import promClient from 'prom-client';
import { publishToQueue } from '../utils/rabbitMQPublisher.js';  // Assumes you are publishing to RabbitMQ
import { matchEndpointLabel } from './endpointLogMap.js';
import {buildTelegrafPayload} from "../data_transformer/telegraf_json.js"

 

import {
  httpRequestCount,
  httpRequestDuration,
  httpResponseCount,
}  from '../monitoring/metrics.js'
 
export const logRequestDetails = async (req, manualLabel = '', mode = 'both') => {
  const startHrTime = process.hrtime();
  const timestamp = new Date().toISOString();
  const currentTimeStamp = new Date();
  const dynamicLabel = matchEndpointLabel(req.method, req.path) || manualLabel || '🗂️ Unknown Endpoint';
  const isoTimestamp = new Date(timestamp).toISOString();

  const shortLog = {
    time: isoTimestamp,
    label: dynamicLabel,
    method: req.method,
    url: req.url,
    protocol: req.protocol,
    headers: req.headers,
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
    cookies: req.cookies || {},
    file: req.file || null,
    files: req.files || [],
  };

  if (mode === 'short' || mode === 'both') {
    console.log(`📝 ${dynamicLabel} @ ${isoTimestamp}`);
    console.table(shortLog);
  }

  const [sec, nano] = process.hrtime(startHrTime);
  const durationMs = (sec * 1000 + nano / 1e6).toFixed(3);
  const durationSeconds = parseFloat(durationMs) / 1000;

  const telegrafLog = buildTelegrafPayload({
    measurement: 'http_logs',
    tags: {
      method: req.method,
      path: req.path,
      label: dynamicLabel,
    },
    fields: {
      duration_ms: parseFloat(durationMs),
      ip: req.ip,
      hostname: req.hostname,
    },
    timestamp: currentTimeStamp.getTime() * 1e6,
  });

  if (mode === 'full' || mode === 'both') {
    await publishToQueue(`logs.request.telegraf.${req.hostname}`, telegrafLog);
    await publishToQueue(`logs.request.${req.hostname}`, fullLog);
  }

  // ✅ Prometheus metrics
  try {
    httpRequestCount.labels(req.method, req.path, dynamicLabel).inc();
    httpRequestDuration.labels(req.method, req.path, dynamicLabel).observe(durationSeconds);
  } catch (err) {
    console.warn('⚠️ Prometheus metric logging failed:', err.message);
  }
};



 export const logResponseDetails = async (req, res, payload, manualLabel = '', mode = 'both') => {
  const startHrTime = process.hrtime();
  const now = Date.now();
  const isoTimestamp = new Date(now).toISOString();
  const dynamicLabel = matchEndpointLabel(req.method, req.path) || manualLabel || '🗂️ Unknown Endpoint';

  const status = payload.status || 200;
  const success = typeof payload.success === 'boolean' ? payload.success : true;
  const message = payload.message || '';
  const data = payload.data || [];
  const rest = { ...payload };
  delete rest.status;
  delete rest.success;
  delete rest.message;
  delete rest.data;

  const apiResponse = {
    success,
    message,
    data,
    ...rest,
  };

  res.status(status).send(apiResponse);

  const [sec, nano] = process.hrtime(startHrTime);
  const durationMs = +(sec * 1000 + nano / 1e6).toFixed(3);
  const durationSeconds = durationMs / 1000;

  const dataLength = Array.isArray(data) ? data.length : 0;
  const totalProfit = Array.isArray(data)
    ? data.reduce((sum, item) => sum + (parseFloat(item.productProfit) || 0), 0)
    : 0;

  const telegrafResponse = buildTelegrafPayload({
    measurement: 'http_responses',
    tags: {
      method: req.method,
      path: req.path,
      label: dynamicLabel,
      status: status.toString(),
    },
    fields: {
      success: success ? 1 : 0,
      message_length: message.length || 0,
      response_size: Buffer.byteLength(JSON.stringify(apiResponse)),
      data_length: dataLength,
      total_profit: +totalProfit.toFixed(2),
      duration_ms: durationMs,
    },
    timestamp: now * 1e6,
  });

  if (mode === 'short' || mode === 'both') {
    console.log(`✅ [${status}] ${dynamicLabel} @ ${isoTimestamp}`);
    console.table({
      method: req.method,
      path: req.path,
      status,
      items: dataLength,
      profit: totalProfit.toFixed(2),
      durationMs,
    });
  }

  if (mode === 'full' || mode === 'both') {
    await publishToQueue(`logs.response.telegraf.${req.hostname}`, telegrafResponse);
    await publishToQueue(`logs.responses.${req.hostname}`, {
      time: isoTimestamp,
      method: req.method,
      path: req.path,
      label: dynamicLabel,
      status,
      responseMeta: apiResponse,
      durationMs,
    });
  }

  // ✅ Prometheus metrics
  try {
    httpRequestCount.labels(req.method, req.path, dynamicLabel).inc();
    httpRequestDuration.labels(req.method, req.path, dynamicLabel).observe(durationSeconds);
    httpResponseCount.labels(req.method, req.path, status.toString()).inc();
  } catch (err) {
    console.warn('⚠️ Prometheus metric logging failed:', err.message);
  }
};
