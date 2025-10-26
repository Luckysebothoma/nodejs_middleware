// monitoring/metricsRoute.js
const express = require('express');
const { register } = require('./metrics');

const router = express.Router();

router.get('/metrics', async (req, res) => {
  console.log("Sending to Metrics ",req.path)
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

module.exports = router;
