// monitoring/httpMetricsMiddleware.js
const { httpRequestDuration } = require('./metrics');

module.exports = function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    end({
      method: req.method,
      route: req.route?.path || req.originalUrl,
      status_code: res.statusCode,
    });
  });

  next();
};
