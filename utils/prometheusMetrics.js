import client from 'prom-client';

const queryDuration = new client.Histogram({
  name: 'mysql_query_duration_seconds',
  help: 'Duration of MySQL queries in seconds',
  labelNames: ['operation'],
});

const queryFailures = new client.Counter({
  name: 'mysql_query_failures_total',
  help: 'Total failed MySQL queries',
  labelNames: ['operation'],
});

export default {
  logQuery: (operation, startTime) => {
    const duration = (Date.now() - startTime) / 1000;
    queryDuration.labels(operation).observe(duration);
  },
  logError: (operation) => {
    queryFailures.labels(operation).inc();
  }
};
