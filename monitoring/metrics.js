// monitoring/metrics.js
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// HTTP Request duration
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
});

// Redis Connection Status (0 = down, 1 = up)
const redisConnectionGauge = new client.Gauge({
  name: 'redis_connection_status',
  help: 'Redis connection status (1 = up, 0 = down)',
});

// Database Query Time
const dbQueryHistogram = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of DB queries in seconds',
  labelNames: ['query_type', 'table'],
  buckets: [0.005, 0.01, 0.1, 0.5, 1],
});

// Component success/failure counters
const componentSuccessCounter = new client.Counter({
  name: 'component_success_total',
  help: 'Number of successful component executions',
  labelNames: ['component'],
});

const componentErrorCounter = new client.Counter({
  name: 'component_errors_total',
  help: 'Number of errors from components',
  labelNames: ['component', 'error_type'],
});

register.registerMetric(httpRequestDuration);
register.registerMetric(redisConnectionGauge);
register.registerMetric(dbQueryHistogram);
register.registerMetric(componentSuccessCounter);
register.registerMetric(componentErrorCounter);

module.exports = {
  register,
  httpRequestDuration,
  redisConnectionGauge,
  dbQueryHistogram,
  componentSuccessCounter,
  componentErrorCounter,
};
