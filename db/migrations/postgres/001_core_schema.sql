-- ============================================================================
-- PostgreSQL 001_core_schema.sql   (PostgreSQL 12+)
-- Clean core schema for Sweety Sweet. Idempotent: safe to re-run.
--
-- Conventions
--   * Table names are UNQUOTED (folded to lower case) because the API writes them unquoted
--     (FROM productList ...); column names are quoted camelCase because the API quotes them
--     ("productId"). This matches every Postgres query in the code base.
--   * productId is INTEGER (int4): node-postgres returns int8/BIGINT/NUMERIC as strings.
--     Money and measures are DOUBLE PRECISION for the same reason.
--   * productList is the parent; per-product tables reference it ON DELETE CASCADE (the API's
--     delete order removes productList before sodEodItems/stockItems and never removes
--     priceTracing/stockedItems; cascades make every order safe and leave no orphans).
--   * Generated columns are read-only and always correct; values the API writes are plain columns
--     that the triggers in 002 only fill when the API leaves them 0/blank.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  "settingKey"    VARCHAR(64)  PRIMARY KEY,
  "settingValue"  VARCHAR(255) NOT NULL,
  description     VARCHAR(255),
  "updatedAt"     TIMESTAMP    NOT NULL DEFAULT now()
);

INSERT INTO app_settings ("settingKey", "settingValue", description) VALUES
  ('markup_rate',          '0.30', 'sellingPrice = costPerItem x (1 + markup_rate). Same as Angular calculateSellingPrice (30%).'),
  ('shop_commission_rate', '0.30', 'Shop share of profit. commissionAmount = (1 - rate) x profit, as product.service SHOP_COMMISSION_RATE.'),
  ('low_stock_threshold',  '5',    'v_stock_status flags a product as low stock at or below this many items.')
ON CONFLICT ("settingKey") DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS productlist_productid_seq;

CREATE TABLE IF NOT EXISTS productList (
  "productId"      INTEGER          PRIMARY KEY DEFAULT nextval('productlist_productid_seq'),
  "productName"    VARCHAR(150)     NOT NULL,
  "productFlavor"  VARCHAR(150)     NOT NULL,
  "productPrice"   DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("productPrice" >= 0),
  image_url        VARCHAR(300)     NOT NULL DEFAULT '',
  "createdAt"      TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP        NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_productlist_name_flavor ON productList (lower("productName"), lower("productFlavor"));
CREATE INDEX IF NOT EXISTS ix_productlist_name ON productList (lower("productName"));

CREATE TABLE IF NOT EXISTS productPricing (
  "productId"          INTEGER          PRIMARY KEY REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "productSize"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "productQuantity"    INTEGER          NOT NULL DEFAULT 1 CHECK ("productQuantity" >= 0),
  "costPerItem"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sellingPrice"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "productProfit"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "productCommission"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "itemGrouping"       INTEGER          NOT NULL DEFAULT 1,
  "unitMargin"  DOUBLE PRECISION GENERATED ALWAYS AS (round(("sellingPrice" - "costPerItem")::numeric, 4)::double precision) STORED,
  "marginPct"   DOUBLE PRECISION GENERATED ALWAYS AS (CASE WHEN "costPerItem" > 0 THEN round((("sellingPrice" - "costPerItem") / "costPerItem" * 100)::numeric, 2)::double precision ELSE 0 END) STORED,
  "packCost"    DOUBLE PRECISION GENERATED ALWAYS AS (round(("costPerItem" * "productQuantity")::numeric, 4)::double precision) STORED,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_productpricing_group ON productPricing ("itemGrouping");

CREATE TABLE IF NOT EXISTS availableItems (
  "productId"       INTEGER   PRIMARY KEY REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "itemsRemaining"  INTEGER   NOT NULL DEFAULT 0 CHECK ("itemsRemaining" >= 0),
  "lastUpdated"     TIMESTAMP NOT NULL DEFAULT now(),
  "isOutOfStock"    BOOLEAN GENERATED ALWAYS AS ("itemsRemaining" <= 0) STORED
);
CREATE INDEX IF NOT EXISTS ix_availableitems_updated ON availableItems ("lastUpdated");

CREATE TABLE IF NOT EXISTS priceTracing (
  "productId"  INTEGER          PRIMARY KEY REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "date"       TIMESTAMP        NOT NULL DEFAULT now(),
  "accAmount"  DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_pricetracing_date ON priceTracing ("date");

CREATE TABLE IF NOT EXISTS estimates (
  "productId"         INTEGER          PRIMARY KEY REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "estimatedSelling"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actualSelling"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastUpdated"       TIMESTAMP        NOT NULL DEFAULT now(),
  variance          DOUBLE PRECISION GENERATED ALWAYS AS (round(("actualSelling" - "estimatedSelling")::numeric, 4)::double precision) STORED,
  "sellThroughPct"  DOUBLE PRECISION GENERATED ALWAYS AS (CASE WHEN "estimatedSelling" > 0 THEN round(("actualSelling" / "estimatedSelling" * 100)::numeric, 2)::double precision ELSE 0 END) STORED
);
CREATE INDEX IF NOT EXISTS ix_estimates_updated ON estimates ("lastUpdated");

CREATE TABLE IF NOT EXISTS sodEodItems (
  "productId"       INTEGER      PRIMARY KEY REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "productName"     VARCHAR(150) NOT NULL DEFAULT '',
  "itemsTaken"      INTEGER      NOT NULL DEFAULT 0,
  "itemsRemaining"  INTEGER      NOT NULL DEFAULT 0,
  "lastUpdated"     TIMESTAMP    NOT NULL DEFAULT now(),
  "availableItems"  INTEGER      NOT NULL DEFAULT 0,
  "outOfStock"      BOOLEAN      NOT NULL DEFAULT false,
  "itemsSold"       INTEGER GENERATED ALWAYS AS ("itemsTaken" - "itemsRemaining") STORED,
  CONSTRAINT chk_sodeoditems_remaining CHECK ("itemsRemaining" >= 0 AND "itemsTaken" >= 0 AND "itemsRemaining" <= "itemsTaken")
);
CREATE INDEX IF NOT EXISTS ix_sodeoditems_updated ON sodEodItems ("lastUpdated");

CREATE TABLE IF NOT EXISTS productItemPricing (
  "productId"           INTEGER          PRIMARY KEY REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "productDescription"  VARCHAR(255)     NOT NULL DEFAULT '',
  "itemGroup"           INTEGER          NOT NULL DEFAULT 1,
  "itemsRemainder"      INTEGER          NOT NULL DEFAULT 0,
  "costOfRemainder"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "groupedQuantity"     INTEGER          NOT NULL DEFAULT 0,
  "groupedProfit"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "groupedCommission"   DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_productitempricing_group ON productItemPricing ("itemGroup");

CREATE TABLE IF NOT EXISTS cartList (
  "cartId"         INTEGER          GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  "productId"      INTEGER          NOT NULL REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "productName"    VARCHAR(150)     NOT NULL DEFAULT '',
  "productFlavor"  VARCHAR(150)     NOT NULL DEFAULT '',
  "productPrice"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "addedAt"        TIMESTAMP        NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cartlist_product ON cartList ("productId");

CREATE TABLE IF NOT EXISTS stockItems (
  "productId"        INTEGER          PRIMARY KEY REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "productName"      VARCHAR(150)     NOT NULL DEFAULT '',
  "productFlavor"    VARCHAR(150)     NOT NULL DEFAULT '',
  "productPrice"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastUpdated"      TIMESTAMP        NOT NULL DEFAULT now(),
  "productQuantity"  INTEGER          NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_stockitems_updated ON stockItems ("lastUpdated");

CREATE SEQUENCE IF NOT EXISTS stockeditems_stockid_seq;

CREATE TABLE IF NOT EXISTS stockedItems (
  "stockId"        INTEGER          PRIMARY KEY DEFAULT nextval('stockeditems_stockid_seq'),
  "productId"      INTEGER          NOT NULL REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE,
  "stockDate"      TIMESTAMP        NOT NULL DEFAULT now(),
  "stockPrice"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "stockQuantity"  INTEGER          NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_stockeditems_product_date ON stockedItems ("productId", "stockDate");

-- Daily financial ledger. Filled automatically by the sodEodItems trigger (see 002).
-- Deliberately NO foreign key: history must survive deleting a product.
CREATE TABLE IF NOT EXISTS daily_financials (
  "businessDate"      DATE             NOT NULL,
  "productId"         INTEGER          NOT NULL,
  "productName"       VARCHAR(150)     NOT NULL DEFAULT '',
  "itemsTaken"        INTEGER          NOT NULL DEFAULT 0,
  "itemsRemaining"    INTEGER          NOT NULL DEFAULT 0,
  "itemsSold"         INTEGER          NOT NULL DEFAULT 0,
  "sellingPrice"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costPerItem"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue             DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost                DOUBLE PRECISION NOT NULL DEFAULT 0,
  profit              DOUBLE PRECISION NOT NULL DEFAULT 0,
  "commissionAmount"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "shopShare"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "recordedAt"        TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP        NOT NULL DEFAULT now(),
  PRIMARY KEY ("businessDate", "productId")
);
CREATE INDEX IF NOT EXISTS ix_daily_financials_product ON daily_financials ("productId", "businessDate");

-- ---------------------------------------------------------------------------
-- Reporting views (read-only). Same formulas the Angular app uses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_product_financials AS
SELECT
  l."productId", l."productName", l."productFlavor", l."productPrice", l.image_url,
  p."productSize", p."productQuantity", p."itemGrouping",
  p."costPerItem", p."sellingPrice", p."productProfit", p."productCommission",
  p."unitMargin", p."marginPct", p."packCost",
  round((CASE WHEN p."productQuantity" > 0 THEN l."productPrice" / p."productQuantity" ELSE 0 END)::numeric, 4)::double precision AS "expectedCostPerItem",
  round((CASE WHEN p."productQuantity" > 0 THEN l."productPrice" / p."productQuantity" ELSE 0 END
         * (1 + COALESCE((SELECT "settingValue"::numeric FROM app_settings WHERE "settingKey" = 'markup_rate'), 0.30)::double precision))::numeric, 4)::double precision AS "expectedSellingPrice",
  (p."productQuantity" > 0 AND (
      abs(p."costPerItem" - l."productPrice" / p."productQuantity") > 0.01
      OR abs(p."sellingPrice" - l."productPrice" / p."productQuantity"
             * (1 + COALESCE((SELECT "settingValue"::numeric FROM app_settings WHERE "settingKey" = 'markup_rate'), 0.30)::double precision)) > 0.01
  )) AS "differsFromFormula"
FROM productList l
JOIN productPricing p ON p."productId" = l."productId";

CREATE OR REPLACE VIEW v_stock_status AS
SELECT
  l."productId", l."productName", l."productFlavor",
  a."itemsRemaining", a."lastUpdated", a."isOutOfStock",
  (a."itemsRemaining" <= COALESCE((SELECT "settingValue"::integer FROM app_settings WHERE "settingKey" = 'low_stock_threshold'), 5)) AS "isLowStock",
  round((a."itemsRemaining" * COALESCE(p."costPerItem", 0))::numeric, 4)::double precision  AS "stockValueAtCost",
  round((a."itemsRemaining" * COALESCE(p."sellingPrice", 0))::numeric, 4)::double precision AS "stockValueAtSelling"
FROM productList l
JOIN availableItems a ON a."productId" = l."productId"
LEFT JOIN productPricing p ON p."productId" = l."productId";

CREATE OR REPLACE VIEW v_daily_summary AS
SELECT
  "businessDate",
  count(*)::integer                                          AS products,
  sum("itemsTaken")::integer                                 AS "itemsTaken",
  sum("itemsSold")::integer                                  AS "itemsSold",
  round(sum(revenue)::numeric, 4)::double precision          AS revenue,
  round(sum(cost)::numeric, 4)::double precision             AS cost,
  round(sum(profit)::numeric, 4)::double precision           AS profit,
  round(sum("commissionAmount")::numeric, 4)::double precision AS "commissionAmount",
  round(sum("shopShare")::numeric, 4)::double precision      AS "shopShare"
FROM daily_financials
GROUP BY "businessDate";
