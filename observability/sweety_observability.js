'use strict';
/**
 * Sweety observability module (additive, opt-in, own Prometheus registry).
 * - Does NOT touch existing prom-client registries/metrics: no duplicate collectors.
 * - Exposes its own metrics at SWEETY_OBS_METRICS_PATH (default /metrics/observability).
 * - Database is authoritative. Gauges are refreshed on an interval (not per scrape),
 *   reset before every refresh so deleted/inactive products never linger.
 * - Multi-replica safe: every replica reports the same DB-derived values; aggregate
 *   with max()/avg() in PromQL, never sum() for stock gauges.
 * - Metrics are NOT durable history; the database remains the system of record.
 */
import { Registry, Gauge, Counter, Histogram } from 'prom-client';
import { randomUUID } from 'crypto';

const ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
const normalize = (r) => {
  if (Array.isArray(r) && Array.isArray(r[0])) return r[0];   // mysql2/promise
  if (r && Array.isArray(r.rows)) return r.rows;               // pg
  return Array.isArray(r) ? r : [];
};
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

function install(app, opts = {}) {
  const env = process.env;
  const cfg = {
    httpMetrics: opts.httpMetrics !== false && env.SWEETY_OBS_HTTP_METRICS !== '0',
    metricsPath: env.SWEETY_OBS_METRICS_PATH || '/metrics/observability',
    token: env.SWEETY_OBS_METRICS_TOKEN || '',
    inventorySql: env.SWEETY_OBS_INVENTORY_SQL || '',
    salesSql: env.SWEETY_OBS_SALES_SQL || '',
    readySql: env.SWEETY_OBS_READY_SQL || 'SELECT 1',
    intervalMs: Math.max(10, parseInt(env.SWEETY_OBS_REFRESH_SECONDS || '60', 10)) * 1000,
    maxSeries: Math.max(1, parseInt(env.SWEETY_OBS_MAX_SERIES || '5000', 10)),
    query: typeof opts.query === 'function' ? opts.query : null,
  };
  const registry = new Registry();
  const g = (name, help, labelNames = []) => new Gauge({ name, help, labelNames, registers: [registry] });

  const stock = g('sweety_product_stock_units', 'Current stock units per product as read from the database', ['product_id', 'category']);
  const syncOk = g('sweety_inventory_sync_last_success_timestamp_seconds', 'Unix time of last successful inventory refresh');
  const syncFail = new Counter({ name: 'sweety_inventory_sync_failures_total', help: 'Failed inventory refresh attempts', registers: [registry] });
  const dbUp = g('sweety_observability_db_up', '1 if the last DB probe (sync or readiness) succeeded, else 0');
  const salesCnt = g('sweety_sales_completed_orders', 'Completed orders (DB-derived; definition set by SWEETY_OBS_SALES_SQL)');
  const salesRev = g('sweety_sales_revenue', 'Revenue of completed orders (DB-derived; currency/basis defined by SWEETY_OBS_SALES_SQL)');
  const salesLast = g('sweety_sales_last_completed_timestamp_seconds', 'Unix time of latest completed order');
  let httpTotal, httpDur;
  if (cfg.httpMetrics) {
    httpTotal = new Counter({ name: 'sweety_http_requests_total', help: 'HTTP requests', labelNames: ['method', 'route', 'status'], registers: [registry] });
    httpDur = new Histogram({ name: 'sweety_http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [registry] });
  }

  // Correlation id + request metrics (route template only => bounded cardinality)
  app.use((req, res, next) => {
    const inbound = req.get('x-request-id');
    req.correlationId = inbound && ID_RE.test(inbound) ? inbound : randomUUID();
    if (!res.getHeader('X-Request-ID')) res.setHeader('X-Request-ID', req.correlationId);
    if (!cfg.httpMetrics || req.path === cfg.metricsPath) return next();
    const end = httpDur.startTimer();
    res.on('finish', () => {
      const route = req.route && req.route.path ? (req.baseUrl || '') + String(req.route.path) : 'unmatched';
      const l = { method: req.method, route, status: String(res.statusCode) };
      end(l); httpTotal.inc(l);
    });
    next();
  });

  async function syncInventory() {
    if (!cfg.inventorySql || !cfg.query) return;
    try {
      const rows = normalize(await withTimeout(cfg.query(cfg.inventorySql), 10000)).slice(0, cfg.maxSeries);
      stock.reset();
      for (const r of rows) {
        const v = Number(r.stock);
        if (!Number.isFinite(v) || r.product_id === undefined) continue;
        stock.set({ product_id: String(r.product_id), category: String(r.category ?? 'unknown') }, v);
      }
      syncOk.set(Date.now() / 1000); dbUp.set(1);
    } catch (e) { syncFail.inc(); dbUp.set(0); console.error('[observability] inventory sync failed:', e.message); }
  }
  async function syncSales() {
    if (!cfg.salesSql || !cfg.query) return;
    try {
      const r = normalize(await withTimeout(cfg.query(cfg.salesSql), 10000))[0] || {};
      if (r.completed_orders != null) salesCnt.set(Number(r.completed_orders));
      if (r.revenue != null) salesRev.set(Number(r.revenue));
      if (r.last_sale_epoch != null) salesLast.set(Number(r.last_sale_epoch));
    } catch (e) { console.error('[observability] sales sync failed:', e.message); }
  }
  const syncAll = async () => { await syncInventory(); await syncSales(); };

  app.get('/livez', (req, res) => res.json({ status: 'alive' }));
  app.get('/readyz', async (req, res) => {
    if (!cfg.query) return res.json({ status: 'ready', db: 'not_configured' });
    try { await withTimeout(cfg.query(cfg.readySql), 3000); dbUp.set(1); res.json({ status: 'ready', db: 'ok' }); }
    catch (e) { dbUp.set(0); res.status(503).json({ status: 'not_ready', db: 'unavailable' }); } // no internals leaked
  });
  app.get(cfg.metricsPath, async (req, res) => {
    if (cfg.token && req.get('authorization') !== `Bearer ${cfg.token}`) return res.status(401).end();
    res.set('Content-Type', registry.contentType); res.end(await registry.metrics());
  });

  if ((cfg.inventorySql || cfg.salesSql) && cfg.query) {
    syncAll();
    const t = setInterval(syncAll, cfg.intervalMs); if (t.unref) t.unref();
  } else if (cfg.inventorySql || cfg.salesSql) {
    console.warn('[observability] SQL configured but no query function supplied (use --query-expr); gauges stay empty.');
  }
  return { registry, syncAll, config: cfg };
}
export default { install };
