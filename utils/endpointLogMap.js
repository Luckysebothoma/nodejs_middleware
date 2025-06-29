// utils/endpointLogMap.js

export const endpointLogMap = [
  { method: 'GET',    path: '/',                  icon: '🛒', subject: 'Home Landing Page' },
  { method: 'GET',    path: '/metrics',           icon: '🔍', subject: 'Prometheus Monitoring Scraping' },
  { method: 'POST',   path: '/update-product',    icon: '🛠️', subject: 'Update Product' },
  { method: 'POST',   path: '/images/temp-key',   icon: '🧠', subject: 'Storing Temporary Images to Redis' },
  { method: 'POST',   path: '/images/temp',       icon: '📸', subject: 'Upload Temporary to Redis' },
  { method: 'POST',   path: '/sortedAsRedisKey',  icon: '📥', subject: 'Sorted As Redis Key Invoked' },
  { method: 'POST',   path: '/upload',            icon: '📤', subject: 'Upload Images Invoked' },
  { method: 'GET',    path: '/api/images/:key',   icon: '🔍', subject: 'Retrieving Images From Redis' },
  { method: 'GET',    path: '/images/temp',       icon: '🖼️', subject: 'Get Temporary Image' },
];
