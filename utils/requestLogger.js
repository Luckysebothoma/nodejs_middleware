import promClient from 'prom-client';
import { publishToQueue, publishToQueueAndTelegraf,publishToQueueAndPrometheus, publishToQueue_Redis } from '../utils/rabbitMQPublisher.js';  // Assumes you are publishing to RabbitMQ
import { matchEndpointLabel } from './endpointLogMap.js';
import {buildTelegrafPayload} from "../data_transformer/telegraf_json.js"
import TimeUtils from '../utils/Time.js';
import { DATE } from 'sequelize';
import {trackToken } from "../config/trackToken.js"
import { initMinioClient, checkMinioConnection, uploadToMinio } from '../config/minioClient.js'

// Initialize once (e.g., on app startup)
initMinioClient()
// Optional: verify connection
await checkMinioConnection()

 
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
export const logRequestDetails = async (req, manualLabel = '', mode = 'both') => {
  const startHrTime = process.hrtime();
  const isoTimestamp = formattedDate(new Date())
   const currentTimeStamp = new Date().toISOString();;
  const dynamicLabel = matchEndpointLabel(req.method, req.path) || manualLabel || '🗂️ Unknown Endpoint';
/*

│ headers  │ '
{"host":"node-js.justdo-it.uk",
"user-agent":"Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
"accept":"application/json, 
text/plain, ","accept-encoding":"gzip, br","accept-language":"en-US,en;q=0.5",
"authorization":"Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InFiODZOdmpTQXNfcVNYTktZRURUQSJ9.eyJpc3MiOiJodHRwczovL2Rldi0zb2NobzQ2MHFhZ3FpcGRzLnVzLmF1dGgwLmNvbS8iLCJzdWIiOiJhdXRoMHw2NzQ2YWFjMzhiNjgwY2RmOTkwN2NjNjgiLCJhdWQiOlsiaHR0cHM6Ly9saW51eC5qdXN0ZG8taXQubG9jYWw6ODA4MyIsImh0dHBzOi8vZGV2LTNvY2hvNDYwcWFncWlwZHMudXMuYXV0aDAuY29tL3VzZXJpbmZvIl0sImlhdCI6MTc1NDU3NzMzNCwiZXhwIjoxNzU0NjYzNzM0LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIG9mZmxpbmVfYWNjZXNzIiwiYXpwIjoiNU5aWklDSVRhOUxDZzhVMGROUXJhVmhHcU5pRXBVVGkiLCJwZXJtaXNzaW9ucyI6WyJkZWxldGU6cHJvZHVjdHMiLCJyZWFkOnByb2R1Y3RzIiwid3JpdGU6cHJvZHVjdHMiXX0.OXn2CTknorGuTwEzUUKIPeIvrSpvDXK4PrQmZ5plELniGIqEFnBTS7y2pXT2bJR_Z6G_d-bIeBBgH2kI0cfeuY3M6NQxSzP5kmxD9AjBJ3JhtiEYik6PQx0Syh4btGrmh7q1KCvXf6woHlAsMAxxWP5zM66UnmgWWhAZ0Jree6pTOMBZxzQwmkKKCHEZ9WKLWbk-Rqc6_m9Ofg1fHI6cosVCaDXs3x8_l4ta2pfmXUBc8LDRArzBSDIRg58FfxOkAty6NhmtkDp6Soz9nmZe_7JmfKkELlk_iQCkhqujtiNaHq_lbPjiQFHJAMN3qtd0ooJX5ZC8lonQeub6KMDHMA",
"cdn-loop":"cloudflare; loops=1",
"cf-connecting-ip":"197.185.194.243",
"cf-ipcountry":"ZA","cf-ray":"96bb7bb3ea2d0386-JNB",
"cf-visitor":"{\\"scheme\\":\\"https\\"}",
"cf-warp-tag-id":"898b2753-50f3-4329-8d36-b7d0dee95449",
"connection":"keep-alive","if-none-match":"W/\\"1f39-QPmBWSTFVtExzOnFyjzlT7veo6k\\"",
"origin":"https://192.168.0.140:4210",
"referer":"https://192.168.0.140:4210/",
"sec-fetch-dest":"empty",
"sec-fetch-mode":"cors",
"sec-fetch-site":"cross-site","x-correlation-id":"req-4pawkzr1k",
"x-forwarded-for":"197.185.194.243",
"x-forwarded-proto":"https",
"x-user-id":"{\\"iss\\":\\"https://dev-3ocho460qagqipds.us.auth0.com/\\",\\"sub\\":\\"auth0|6746aac38b680cdf9907cc68\\",\\"aud\\":[\\"https://linux.justdo-it.local:8083\\",\\"https://dev-3ocho460qagqipds.us.auth0.com/userinfo\\"],\\"iat\\":1754577334,\\"exp\\":1754663734,\\"scope\\":\\"openid profile email offline_access\\",\\"azp\\":\\"5NZZICITa9LCg8U0dNQraVhGqNiEpUTi\\",\\"permissions\\":[\\"delete:products\\",\\"read:products\\",\\"write:products\\"]}"}

*/

  const correlationId = req.headers['x-correlation-id'] || `req-${Date.now()}`;
  const userId = req.headers['x-user-id'] || 'anonymous';
  const authToken = req.headers['authorization'] || '';
  const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  const userAgent = req.headers['user-agent'] || '';
  const cfRay = req.headers['cf-ray'] || '';

  const shortLog = {
    time: isoTimestamp,
    label: dynamicLabel,
    method: JSON.stringify(req.method),
    url: JSON.stringify(req.url),
    protocol: JSON.stringify(req.protocol),
    correlationId: correlationId,
    userId:userId,
    authToken:authToken,
    clientIp:clientIp,
    userAgent:userAgent,
    cfRay:cfRay

  };

    const logData = {
    method: req.method,
    url: req.originalUrl,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
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
    headers: req.headers
  };

  if (mode === 'short' || mode === 'both') {
    console.log(`
      #######################################################################################3
      
      📝 ${dynamicLabel} @ ${isoTimestamp}

      
      
      #######################################################################################3

      `);

 
    //console.table(shortLog);
  }

  const [sec, nano] = process.hrtime(startHrTime);
  const durationMs = (sec * 1000 + nano / 1e6).toFixed(3);
  const durationSeconds = parseFloat(durationMs) / 1000;

  const telegrafLog = buildTelegrafPayload({
    timestamp: getLongTime(new Date()),
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
    
  });

  if (mode === 'full' || mode === 'both') {

 //   await publishToQueue(`logs.request.telegraf.${req.hostname}${req.path}`, telegrafLog);
 //   await publishToQueue(`logs.request.${req.hostname}${req.path}`, fullLog);
//    await publishToQueue_Redis(`logs.request.telegraf.${req.hostname}${req.path}`, telegrafLog);
 //   await publishToQueue_Redis(`logs.request.${req.hostname}${req.path}`, fullLog);
//    await publishToQueue_Redis(`logs.request.log.${req.hostname}${req.path}`, shortLog);

      const topic = `logs.request.${req.hostname}${req.path}`
    await publishToQueue_Redis(`logs.request.log.${req.hostname}${req.path}`, logData);
   // await publishToQueueAndTelegraf(`logs.request.telegraf.${req.hostname}${req.path}`, telegrafLog);
    await uploadToMinio('request-logs', topic, logData)


    
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


  const correlationId = req.headers['x-correlation-id'] || `req-${Date.now()}`;
  const userId = req.headers['x-user-id'] || 'anonymous';
  const authToken = req.headers['authorization'] || '';
  const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  const userAgent = req.headers['user-agent'] || '';
  const cfRay = req.headers['cf-ray'] || '';


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
 




      const logData = {
    method: req.method,
    url: req.originalUrl,
    status: apiResponse.success,
    message: apiResponse.message,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    timestamp: new Date().toISOString(),
    data: JSON.stringify(apiResponse.data)
  };

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
      correlationId:req.correlationId,
      method: req.method,
      path: req.path,
      label: dynamicLabel,
      status: apiResponse.success,
    },
    fields: {
      success: apiResponse.success ? 1 : 0,
      message_length: message.length || 0,
      response_size: Buffer.byteLength(JSON.stringify(Global_apiResponse)),
      data_length:  JSON.stringify(payload).length,
      data_payload:data,
      payload:  [`correlationId:${correlationId}`, JSON.stringify(payload)],
      duration_ms: durationMs,
      payloadSize: payload.length || -1,
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
      //response_data:  JSON.stringify(payload),
      duration:durationMs,
      //label: dynamicLabel,
      //time: isoTimestamp,
      //hostname: req.hostname
    });
  }

  if (mode === 'full' || mode === 'both') {

      const topic = `logs.response.${req.hostname}${req.path}`
    await publishToQueue_Redis(`logs.response.log.${req.hostname}${req.path}`, logData);
   // await publishToQueueAndTelegraf(`logs.response.telegraf.${req.hostname}${req.path}`, telegrafResponse);
    //await uploadToMinio('response-logs', topic, logData)

  //  await publishToQueue_Redis(`logs.response.telegraf.${req.hostname}${req.path}`, telegrafLog);
  //  await publishToQueue_Redis(`logs.response.${req.hostname}${req.path}`, fullLog);
  }


};
