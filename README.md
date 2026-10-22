# nodejsMiddleware
# nodejs_middleware

## Observability

Each API worker exposes `/metrics/observability` in addition to the existing
`/metrics` endpoint. The observability endpoint includes request metrics,
per-product stock from MySQL (`sweety_product_stock_units`), database
availability (`sweety_database_up`), schema health
(`sweety_database_schema_ok`), and the latest applied migration version
(`sweety_database_migration_version`) plus whether all checked-in migrations
are applied (`sweety_database_migrations_current`) for MySQL and PostgreSQL.

`/livez` reports process liveness. `/readyz` checks both database connections,
their recorded migration versions, and the expected schema; it returns HTTP
503 if either database or schema is unhealthy. Inventory refresh runs once
per `SWEETY_OBS_REFRESH_SECONDS` (default 60). Set `SWEETY_OBS_METRICS_TOKEN`
to require a bearer token when scraping the observability metrics endpoint.
