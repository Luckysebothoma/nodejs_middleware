import promClient from 'prom-client';
import { publishToQueue, publishToQueueAndPrometheus } from '../utils/rabbitMQPublisher.js';  // Assumes you are publishing to RabbitMQ
import { matchEndpointLabel } from './endpointLogMap.js';
import {buildTelegrafPayload} from "../data_transformer/telegraf_json.js"
 


 import TimeUtils from '../utils/Time.js';
import { DATE } from 'sequelize';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

export const logRequestDetails = async (req, manualLabel = '', mode = 'both') => {
  const startHrTime = process.hrtime();
  const isoTimestamp = formattedDate(new Date())
   const currentTimeStamp = new Date().toISOString();;
  const dynamicLabel = matchEndpointLabel(req.method, req.path) || manualLabel || '🗂️ Unknown Endpoint';
  
 
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
      fullLog
    },
    fields: {
      duration_ms: parseFloat(durationMs),
      ip: req.ip,
      hostname: req.hostname,
    },
    timestamp: getLongTime(new Date()),
  });

  if (mode === 'full' || mode === 'both') {

 //   await publishToQueue(`logs.request.telegraf.${req.hostname}${req.path}`, telegrafLog);
 //   await publishToQueue(`logs.request.${req.hostname}${req.path}`, fullLog);
    await publishToQueueAndPrometheus(`logs.request.telegraf.${req.hostname}${req.path}`, telegrafLog);
    await publishToQueueAndPrometheus(`logs.request.${req.hostname}${req.path}`, fullLog);


    
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
  const now = new Date();
  const isoTimestamp = new Date(now).toISOString();
  const dynamicLabel = matchEndpointLabel(req.method, req.path) || manualLabel || '🗂️ Unknown Endpoint';
  const Global_Success_Status = false
  const Global_apiResponse = false

   const message = "" || '';
   console.log("payload to be sent", JSON.stringify(payload).length)
  const data = payload || [];

  const apiResponse ={
      success:false,
      message: message,
      data: JSON.stringify(payload)
    } 
  if(status === 200){
     const apiResponseStatus = {
    success:true,
    message:`Success`,
    data: payload,
   };
 
  res.status(status).send(apiResponseStatus);

  }else{


    const apiResponse = {
    success:false,
    message:`Failed`,
    data:JSON.stringify(payload),
   };

 

  res.status(status).send(apiResponse);


  }
 




  const [sec, nano] = process.hrtime(startHrTime);
  const durationMs = +(sec * 1000 + nano / 1e6).toFixed(3);
  const durationSeconds = durationMs / 1000;

 // const dataLength = Array.isArray(data) ? data.length : 0;
 // const payloadLength= payload.length;
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
      success: apiResponse.success ? 1 : 0,
      message_length: message.length || 0,
      response_size: Buffer.byteLength(JSON.stringify(Global_apiResponse)),
      data_length:  JSON.stringify(payload),
      data_payload:data,
      payload:  JSON.stringify(payload),
      duration_ms: durationMs,
      payloadSize: payload.length,
      duration:durationMs,
      label: dynamicLabel,
      time: isoTimestamp,
      hostname: req.hostname
      
    },
    timestamp: now * 1e6,
  });

  if (mode === 'short' || mode === 'both') {
    //console.log(`✅ [${status}] ${dynamicLabel} @ ${isoTimestamp}`);
    console.table({
      method: req.method,
      endpoint: req.path,
      httpsStatus: status,
      response_data:  JSON.stringify(payload),
      duration:durationMs,
      label: dynamicLabel,
      time: isoTimestamp,
      hostname: req.hostname
    });
  }

  if (mode === 'full' || mode === 'both') {

    await publishToQueueAndPrometheus(`logs.response.telegraf.${req.hostname}.${req.path}`, telegrafResponse);
    await publishToQueueAndPrometheus(`logs.responses.${req.hostname}.${req.path}`, {
      time: isoTimestamp,
      method: req.method,
      path: req.path,
      label: dynamicLabel,
      status:status,
      responseMeta: apiResponse.success,
      durationMs,
      payload: data
    });

  //  await publishToQueueAndPrometheus(`logs.response.telegraf.${req.hostname}${req.path}`, telegrafLog);
  //  await publishToQueueAndPrometheus(`logs.response.${req.hostname}${req.path}`, fullLog);
  }


};
