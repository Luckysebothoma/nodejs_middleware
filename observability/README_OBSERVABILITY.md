# Sweety observability module

Opt-in, additive. Own registry; existing metrics are untouched.

Endpoints (added by `install(app, { query, httpMetrics })`):
- `GET /livez`  – process liveness only (never depends on the DB).
- `GET /readyz` – runs `SWEETY_OBS_READY_SQL` (default `SELECT 1`); 503 on failure, no internals in body.
- `GET /metrics/observability` – Prometheus text (optional `Authorization: Bearer $SWEETY_OBS_METRICS_TOKEN`).

Metrics: `sweety_product_stock_units{product_id,category}`, `sweety_inventory_sync_last_success_timestamp_seconds`,
`sweety_inventory_sync_failures_total`, `sweety_observability_db_up`, `sweety_sales_completed_orders`,
`sweety_sales_revenue`, `sweety_sales_last_completed_timestamp_seconds`,
`sweety_http_requests_total`, `sweety_http_request_duration_seconds` (labels: method, route template, status).

SQL contracts (you define them from the verified schema; nothing is assumed):
- `SWEETY_OBS_INVENTORY_SQL`: columns `product_id, category, stock`
- `SWEETY_OBS_SALES_SQL`: one row with `completed_orders, revenue, last_sale_epoch`
  (decide which order/payment states count as completed and which currency/basis applies).

Notes: gauges are refreshed on an interval and reset first (no stale products). With several replicas
use `max by (product_id)(…)`, never `sum`. Metrics are not durable history; the DB is the source of truth.
Rollback: remove the guarded block between the `sweety-observability` markers in the entry file
(or `git checkout` the branch), or set `SWEETY_OBS_INVENTORY_SQL`/`SWEETY_OBS_SALES_SQL` empty and
`SWEETY_OBS_HTTP_METRICS=0` to neutralise it without a code change.
