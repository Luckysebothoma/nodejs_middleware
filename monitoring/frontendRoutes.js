// monitoring/frontendRoutes.js
const express = require('express');
const router = express.Router();
const client = require('prom-client');

const {
  componentErrorCounter,
  componentSuccessCounter,
} = require('./metrics');

const customMetrics = {}; // Dynamic registry for frontend metrics

router.post('/frontend-console-log', (req, res) => {
  const { log } = req.body;
  console.log(`[Frontend Log] 📘 ${log}`);
  res.status(200).send('Log received');
});

router.post('/frontend-error', (req, res) => {
  const { componentName, value } = req.body;

  console.error(`[Frontend Error] ❌ ${componentName}: ${value}`);

  componentErrorCounter.inc({
    component: componentName,
    error_type: 'frontend',
  });

  res.status(200).send('Frontend error tracked');
});

router.post('/frontend-console-metric', (req, res) => {
  const { metricName, value, type = 'gauge', labels = {} } = req.body;

  if (!metricName || typeof value !== 'number') {
    return res.status(400).send('Invalid metric payload');
  }

  if (!customMetrics[metricName]) {
    if (type === 'gauge') {
      customMetrics[metricName] = new client.Gauge({
        name: metricName,
        help: `Frontend custom metric: ${metricName}`,
        labelNames: Object.keys(labels),
      });
    } else if (type === 'counter') {
      customMetrics[metricName] = new client.Counter({
        name: metricName,
        help: `Frontend custom counter: ${metricName}`,
        labelNames: Object.keys(labels),
      });
    } else {
      return res.status(400).send('Unsupported metric type');
    }
  }

  const metric = customMetrics[metricName];

  if (type === 'gauge') {
    metric.set(labels, value);
  } else if (type === 'counter') {
    metric.inc(labels, value);
  }

  res.status(200).send('Frontend metric recorded');
});
  
module.exports = router;
