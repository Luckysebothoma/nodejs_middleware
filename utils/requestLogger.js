import promClient from 'prom-client';
import { publishToQueue } from '../utils/rabbitMQPublisher.js';  // Assumes you are publishing to RabbitMQ
import { matchEndpointLabel } from './endpointLogMap.js';
import {buildTelegrafPayload} from "../data_transformer/telegraf_json.js"
 
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
    //console.table(shortLog);
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
    await publishToQueue(`logs.request.telegraf.${req.hostname}.${req.path}`, telegrafLog);
    await publishToQueue(`logs.request.${req.hostname}.${req.path}`, fullLog);
  }


  /*
  // ✅ Prometheus metrics
  try {
    httpRequestCount.labels(req.method, req.path, dynamicLabel).inc();
    httpRequestDuration.labels(req.method, req.path, dynamicLabel).observe(durationSeconds);
  } catch (err) {
    console.warn('⚠️ Prometheus metric logging failed:', err.message);
  }

  */
};



 export const logResponseDetails = async (req, res, payload, manualLabel = '', status=500 ,mode = 'both') => {
  const startHrTime = process.hrtime();
  const now = Date.now();
  const isoTimestamp = new Date(now).toISOString();
  const dynamicLabel = matchEndpointLabel(req.method, req.path) || manualLabel || '🗂️ Unknown Endpoint';
  let Global_Success_Status = false
  let Global_apiResponse = false

   const message = "" || '';
   console.log("payload to be sent", JSON.stringify(payload).length)
  const data = payload || [];

  
  if(status === 200){
     const apiResponseStatus = {
    success:true,
    message:message,
    data: payload,
   };
   Global_apiResponse = apiResponseStatus
   Global_Success_Status =true
  res.status(status).send(apiResponseStatus);

  }else{
     const apiResponse = {
    success:false,
    message:message,
    data:JSON.stringify(payload),
   };
   Global_Success_Status = false
   Global_apiResponse = apiResponse

  res.status(status).send(apiResponse);

  }
 




  const [sec, nano] = process.hrtime(startHrTime);
  const durationMs = +(sec * 1000 + nano / 1e6).toFixed(3);
  const durationSeconds = durationMs / 1000;

  const dataLength = Array.isArray(data) ? data.length : 0;
  const payloadLength= payload.length;
  const totalProfit = Array.isArray(data)

//    ? data.reduce((sum, item) => sum + (parseFloat(item.productProfit) || 0), 0)
//    : 0;

  const telegrafResponse = buildTelegrafPayload({
    measurement: 'http_responses',
    tags: {
      method: req.method,
      path: req.path,
      label: dynamicLabel,
      status: status.toString(),
    },
    fields: {
      success: Global_Success_Status ? 1 : 0,
      message_length: message.length || 0,
      response_size: Buffer.byteLength(JSON.stringify(Global_apiResponse)),
      data_length: payloadLength,
      data_payload:data,
      duration_ms: durationMs,
    },
    timestamp: now * 1e6,
  });

  if (mode === 'short' || mode === 'both') {
    //console.log(`✅ [${status}] ${dynamicLabel} @ ${isoTimestamp}`);
    console.table({
      method: req.method,
      path: req.path,
      status,
      items: payloadLength,
      payload: payload,
      durationMs,
    });
  }

  if (mode === 'full' || mode === 'both') {
    await publishToQueue(`logs.response.telegraf.${req.hostname}.${req.path}`, telegrafResponse);
    await publishToQueue(`logs.responses.${req.hostname}.${req.path}`, {
      time: isoTimestamp,
      method: req.method,
      path: req.path,
      label: dynamicLabel,
      status,
      responseMeta: Global_apiResponse,
      durationMs,
      payload: data
    });
  }


};
