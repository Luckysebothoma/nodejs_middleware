import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

function safeRegister(name, metric) {
  try {
    if (!register.getSingleMetric(name)) {
      register.registerMetric(metric);
    }
  } catch (err) {
    console.warn(`⚠️ Metric "${name}" registration skipped:`, err.message);
  }
}

// Histogram for HTTP request durations
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
});
safeRegister(httpRequestDuration.name, httpRequestDuration);

// Counter for total HTTP requests
export const httpRequestCount = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'label'],
});
safeRegister(httpRequestCount.name, httpRequestCount);

// Counter for HTTP responses
export const httpResponseCount = new client.Counter({
  name: 'http_responses_total',
  help: 'Total number of HTTP responses sent',
  labelNames: ['method', 'path', 'status'],
});
safeRegister(httpResponseCount.name, httpResponseCount);

// Gauge for Redis connection status
export const redisConnectionGauge = new client.Gauge({
  name: 'redis_connection_status',
  help: 'Redis connection status (1 = up, 0 = down)',
});
safeRegister(redisConnectionGauge.name, redisConnectionGauge);

// Histogram for DB query durations
export const dbQueryHistogram = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of DB queries in seconds',
  labelNames: ['query_type', 'table'],
  buckets: [0.005, 0.01, 0.1, 0.5, 1],
});
safeRegister(dbQueryHistogram.name, dbQueryHistogram);

// Histogram for request durations (index route)
const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds_index",
  help: "HTTP request durations",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5]
});
safeRegister(httpDuration.name, httpDuration);

// Counter for component-level errors
export const componentErrorCounter = new client.Counter({
  name: 'component_errors_total',
  help: 'Number of errors from components',
  labelNames: ['component', 'error_type'],
});
safeRegister(componentErrorCounter.name, componentErrorCounter);

// Counter for component-level success
export const componentSuccessCounter = new client.Counter({
  name: 'component_success_total',
  help: 'Number of successful component executions',
  labelNames: ['component'],
});
safeRegister(componentSuccessCounter.name, componentSuccessCounter);
