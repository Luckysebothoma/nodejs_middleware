-- ============================================================================
-- MySQL 001_core_schema.sql   (MySQL 8.0.16+; InnoDB; utf8mb4)
-- Clean core schema for Sweety Sweet. Idempotent: every statement is safe to re-run.
--
-- Conventions
--   * productId is INT (not BIGINT): the API's MySQL pool uses bigNumberStrings, so BIGINT and
--     DECIMAL would reach the Angular app as strings. Money and measures are DOUBLE for the same
--     reason (the app computes with JavaScript numbers).
--   * Column names match the API's SQL exactly (camelCase).
--   * productList is the parent; every per-product table references it ON DELETE CASCADE, so the
--     API's delete order (it removes productList BEFORE sodEodItems/stockItems and never removes
--     priceTracing/stockedItems) always works and leaves no orphans.
--   * "Auto" columns are GENERATED (read-only, always correct). Values the API writes itself are
--     plain columns; the triggers in 002 only fill them when the API leaves them 0/blank.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  settingKey    VARCHAR(64)  NOT NULL,
  settingValue  VARCHAR(255) NOT NULL,
  description   VARCHAR(255) NULL,
  updatedAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (settingKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO app_settings (settingKey, settingValue, description) VALUES
  ('markup_rate',          '0.30', 'sellingPrice = costPerItem x (1 + markup_rate). Same as Angular calculateSellingPrice (30%).'),
  ('shop_commission_rate', '0.30', 'Shop share of profit. commissionAmount = (1 - rate) x profit, as product.service SHOP_COMMISSION_RATE.'),
  ('low_stock_threshold',  '5',    'v_stock_status flags a product as low stock at or below this many items.')
ON DUPLICATE KEY UPDATE settingKey = settingKey;

CREATE TABLE IF NOT EXISTS productList (
  productId      INT           NOT NULL AUTO_INCREMENT,
  productName    VARCHAR(150)  NOT NULL,
  productFlavor  VARCHAR(150)  NOT NULL,
  productPrice   DOUBLE        NOT NULL DEFAULT 0,
  image_url      VARCHAR(300)  NOT NULL DEFAULT '',
  createdAt      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (productId),
  UNIQUE KEY uq_productList_name_flavor (productName, productFlavor),
  KEY ix_productList_name (productName),
  CONSTRAINT chk_productList_price CHECK (productPrice >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS productPricing (
  productId          INT     NOT NULL,
  productSize        DOUBLE  NOT NULL DEFAULT 0,
  productQuantity    INT     NOT NULL DEFAULT 1,
  costPerItem        DOUBLE  NOT NULL DEFAULT 0,
  sellingPrice       DOUBLE  NOT NULL DEFAULT 0,
  productProfit      DOUBLE  NOT NULL DEFAULT 0,
  productCommission  DOUBLE  NOT NULL DEFAULT 0,
  itemGrouping       INT     NOT NULL DEFAULT 1,
  unitMargin  DOUBLE GENERATED ALWAYS AS (ROUND(sellingPrice - costPerItem, 4)) STORED,
  marginPct   DOUBLE GENERATED ALWAYS AS (CASE WHEN costPerItem > 0 THEN ROUND((sellingPrice - costPerItem) / costPerItem * 100, 2) ELSE 0 END) STORED,
  packCost    DOUBLE GENERATED ALWAYS AS (ROUND(costPerItem * productQuantity, 4)) STORED,
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (productId),
  KEY ix_productPricing_group (itemGrouping),
  CONSTRAINT fk_productPricing_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_productPricing_qty CHECK (productQuantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS availableItems (
  productId       INT      NOT NULL,
  itemsRemaining  INT      NOT NULL DEFAULT 0,
  lastUpdated     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  isOutOfStock    TINYINT(1) GENERATED ALWAYS AS (itemsRemaining <= 0) STORED,
  PRIMARY KEY (productId),
  KEY ix_availableItems_updated (lastUpdated),
  CONSTRAINT fk_availableItems_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_availableItems_remaining CHECK (itemsRemaining >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS priceTracing (
  productId  INT      NOT NULL,
  date       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accAmount  DOUBLE   NOT NULL DEFAULT 0,
  PRIMARY KEY (productId),
  KEY ix_priceTracing_date (date),
  CONSTRAINT fk_priceTracing_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS estimates (
  productId         INT      NOT NULL,
  estimatedSelling  DOUBLE   NOT NULL DEFAULT 0,
  actualSelling     DOUBLE   NOT NULL DEFAULT 0,
  lastUpdated       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  variance        DOUBLE GENERATED ALWAYS AS (ROUND(actualSelling - estimatedSelling, 4)) STORED,
  sellThroughPct  DOUBLE GENERATED ALWAYS AS (CASE WHEN estimatedSelling > 0 THEN ROUND(actualSelling / estimatedSelling * 100, 2) ELSE 0 END) STORED,
  PRIMARY KEY (productId),
  KEY ix_estimates_updated (lastUpdated),
  CONSTRAINT fk_estimates_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sodEodItems (
  productId       INT          NOT NULL,
  productName     VARCHAR(150) NOT NULL DEFAULT '',
  itemsTaken      INT          NOT NULL DEFAULT 0,
  itemsRemaining  INT          NOT NULL DEFAULT 0,
  lastUpdated     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  availableItems  INT          NOT NULL DEFAULT 0,
  outOfStock      TINYINT(1)   NOT NULL DEFAULT 0,
  itemsSold       INT GENERATED ALWAYS AS (itemsTaken - itemsRemaining) STORED,
  PRIMARY KEY (productId),
  KEY ix_sodEodItems_updated (lastUpdated),
  CONSTRAINT fk_sodEodItems_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_sodEodItems_remaining CHECK (itemsRemaining >= 0 AND itemsTaken >= 0 AND itemsRemaining <= itemsTaken)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS productItemPricing (
  productId           INT          NOT NULL,
  productDescription  VARCHAR(255) NOT NULL DEFAULT '',
  itemGroup           INT          NOT NULL DEFAULT 1,
  itemsRemainder      INT          NOT NULL DEFAULT 0,
  costOfRemainder     DOUBLE       NOT NULL DEFAULT 0,
  groupedQuantity     INT          NOT NULL DEFAULT 0,
  groupedProfit       DOUBLE       NOT NULL DEFAULT 0,
  groupedCommission   DOUBLE       NOT NULL DEFAULT 0,
  PRIMARY KEY (productId),
  KEY ix_productItemPricing_group (itemGroup),
  CONSTRAINT fk_productItemPricing_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cartList (
  cartId         INT          NOT NULL AUTO_INCREMENT,
  productId      INT          NOT NULL,
  productName    VARCHAR(150) NOT NULL DEFAULT '',
  productFlavor  VARCHAR(150) NOT NULL DEFAULT '',
  productPrice   DOUBLE       NOT NULL DEFAULT 0,
  addedAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cartId),
  KEY ix_cartList_product (productId),
  CONSTRAINT fk_cartList_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stockItems (
  productId        INT          NOT NULL,
  productName      VARCHAR(150) NOT NULL DEFAULT '',
  productFlavor    VARCHAR(150) NOT NULL DEFAULT '',
  productPrice     DOUBLE       NOT NULL DEFAULT 0,
  lastUpdated      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  productQuantity  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (productId),
  KEY ix_stockItems_updated (lastUpdated),
  CONSTRAINT fk_stockItems_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stockedItems (
  stockId        INT      NOT NULL AUTO_INCREMENT,
  productId      INT      NOT NULL,
  stockDate      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stockPrice     DOUBLE   NOT NULL DEFAULT 0,
  stockQuantity  INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (stockId),
  KEY ix_stockedItems_product_date (productId, stockDate),
  CONSTRAINT fk_stockedItems_product FOREIGN KEY (productId) REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Daily financial ledger. Filled automatically by the sodEodItems triggers (see 002).
-- Deliberately NO foreign key: history must survive deleting a product.
CREATE TABLE IF NOT EXISTS daily_financials (
  businessDate      DATE         NOT NULL,
  productId         INT          NOT NULL,
  productName       VARCHAR(150) NOT NULL DEFAULT '',
  itemsTaken        INT          NOT NULL DEFAULT 0,
  itemsRemaining    INT          NOT NULL DEFAULT 0,
  itemsSold         INT          NOT NULL DEFAULT 0,
  sellingPrice      DOUBLE       NOT NULL DEFAULT 0,
  costPerItem       DOUBLE       NOT NULL DEFAULT 0,
  revenue           DOUBLE       NOT NULL DEFAULT 0,
  cost              DOUBLE       NOT NULL DEFAULT 0,
  profit            DOUBLE       NOT NULL DEFAULT 0,
  commissionAmount  DOUBLE       NOT NULL DEFAULT 0,
  shopShare         DOUBLE       NOT NULL DEFAULT 0,
  recordedAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (businessDate, productId),
  KEY ix_daily_financials_product (productId, businessDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Reporting views (read-only). Same formulas the Angular app uses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_product_financials AS
SELECT
  l.productId, l.productName, l.productFlavor, l.productPrice, l.image_url,
  p.productSize, p.productQuantity, p.itemGrouping,
  p.costPerItem, p.sellingPrice, p.productProfit, p.productCommission,
  p.unitMargin, p.marginPct, p.packCost,
  ROUND(CASE WHEN p.productQuantity > 0 THEN l.productPrice / p.productQuantity ELSE 0 END, 4) AS expectedCostPerItem,
  ROUND(CASE WHEN p.productQuantity > 0 THEN l.productPrice / p.productQuantity ELSE 0 END
        * (1 + COALESCE((SELECT CAST(settingValue AS DECIMAL(12,6)) FROM app_settings WHERE settingKey = 'markup_rate'), 0.30)), 4) AS expectedSellingPrice,
  CASE WHEN p.productQuantity > 0 AND (
         ABS(p.costPerItem - l.productPrice / p.productQuantity) > 0.01
         OR ABS(p.sellingPrice - l.productPrice / p.productQuantity
                * (1 + COALESCE((SELECT CAST(settingValue AS DECIMAL(12,6)) FROM app_settings WHERE settingKey = 'markup_rate'), 0.30))) > 0.01
       ) THEN 1 ELSE 0 END AS differsFromFormula
FROM productList l
JOIN productPricing p ON p.productId = l.productId;

CREATE OR REPLACE VIEW v_stock_status AS
SELECT
  l.productId, l.productName, l.productFlavor,
  a.itemsRemaining, a.lastUpdated, a.isOutOfStock,
  CASE WHEN a.itemsRemaining <= COALESCE((SELECT CAST(settingValue AS SIGNED) FROM app_settings WHERE settingKey = 'low_stock_threshold'), 5)
       THEN 1 ELSE 0 END AS isLowStock,
  ROUND(a.itemsRemaining * COALESCE(p.costPerItem, 0), 4)    AS stockValueAtCost,
  ROUND(a.itemsRemaining * COALESCE(p.sellingPrice, 0), 4)   AS stockValueAtSelling
FROM productList l
JOIN availableItems a ON a.productId = l.productId
LEFT JOIN productPricing p ON p.productId = l.productId;

CREATE OR REPLACE VIEW v_daily_summary AS
SELECT
  businessDate,
  COUNT(*) * 1.0e0                 AS products,        -- x 1.0e0 = DOUBLE: BIGINT/DECIMAL would reach the API as strings
  SUM(itemsTaken) * 1.0e0          AS itemsTaken,
  SUM(itemsSold) * 1.0e0           AS itemsSold,
  ROUND(SUM(revenue), 4)           AS revenue,
  ROUND(SUM(cost), 4)              AS cost,
  ROUND(SUM(profit), 4)            AS profit,
  ROUND(SUM(commissionAmount), 4)  AS commissionAmount,
  ROUND(SUM(shopShare), 4)         AS shopShare
FROM daily_financials
GROUP BY businessDate;
