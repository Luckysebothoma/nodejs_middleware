// utils/requestLogger.js
import { publishToQueue } from './rabbitMQPublisher.js';
import { endpointLogMap } from './endpointLogMap.js';
import pathToRegexp from 'path-to-regexp';

const matchEndpointLabel = (method, urlPath) => {
  for (const entry of endpointLogMap) {
    const keys = [];
    const regex = pathToRegexp(entry.path, keys, { end: true });
    
    if (entry.method === method && regex.test(urlPath)) {
      return `${entry.icon} ${entry.subject}`;
    }
  }
  return null;
};

export const logRequestDetails = async (req, manualLabel = '', mode = 'both') => {
  const timestamp = new Date().toISOString();
  const dynamicLabel = matchEndpointLabel(req.method, req.path) || manualLabel || '🗂️ Unknown Endpoint';

  const shortLog = {
    time: timestamp,
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
    console.log(`📝 ${dynamicLabel} @ ${timestamp}`);
    console.table(shortLog);
  }

  if (mode === 'full' || mode === 'both') {
    await publishToQueue('logs.requests', fullLog);
  }
};
