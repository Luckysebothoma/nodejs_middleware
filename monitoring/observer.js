// monitoring/observer.js
const {
  redisConnectionGauge,
  dbQueryHistogram,
  componentSuccessCounter,
  componentErrorCounter,
} = require('./metrics');

module.exports = {
  observeRedisConnection: (isConnected) => {
    redisConnectionGauge.set(isConnected ? 1 : 0);
  },

  observeDBQuery: (queryType, tableName, durationInSeconds) => {
    dbQueryHistogram.observe({ query_type: queryType, table: tableName }, durationInSeconds);
  },

  observeComponentSuccess: (component) => {
    componentSuccessCounter.inc({ component });
  },

  observeComponentError: (component, error) => {
    componentErrorCounter.inc({ component, error_type: error.name || 'unknown' });
    console.error(`[MONITOR] Component "${component}" failed:`, error);
  },
};
