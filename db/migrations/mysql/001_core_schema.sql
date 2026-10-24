-- ============================================================================
-- MySQL 003_recipes_inventory_production.sql   (MySQL 8.0.16+ incl. 9.x, InnoDB, utf8mb4)
-- Recipes, component inventory, production ledger, capacity views, observability log.
--
-- SAFE / NON-BLOCKING / IDEMPOTENT
--   * Every statement is IF NOT EXISTS / OR REPLACE / ON DUPLICATE KEY / DROP IF EXISTS, so a
--     re-run after any failure is harmless and nothing is ever dropped except this files own
--     triggers (recreated immediately).
--   * lock_wait_timeout = 10s: if the API holds a metadata lock the statement fails fast instead
--     of queueing behind it and stalling every other query on that table.
--   * Single-statement trigger bodies: no DELIMITER needed (works through mysql2 multi-statement).
--   * Does not touch 001/002 or any existing table. 001 is NOT part of this delivery: its
--     "checksum drift" means the applied 001 was edited, so do not modify it again.
--
-- FIX vs previous draft: recipes no longer uses an indexed VIRTUAL column for the
-- "one active recipe per product" rule. MySQL rejects a foreign key (CASCADE) on the base column
-- of an indexed generated column (ER_CANNOT_ADD_FOREIGN_BASE_COL_VCOL), so activeProductId is
-- now a plain nullable column maintained by BEFORE INSERT/UPDATE triggers, with the same UNIQUE
-- key (NULLs are allowed many times, so any number of inactive recipes is fine).
--
-- BUSINESS RULES
--   * productPricing.productSize (10/100/1000) is a LABEL ONLY, never drives stock or yield.
--   * Finished stock stays in availableItems, component stock lives in componentStock.
--   * Units only for components (G, KG, ML, L, EA, PCS). MASS<->VOLUME not converted:
--     flagged UNIT_MISMATCH, capacity 0.
--   * productionBatches / productionBatchComponents are a LEDGER ONLY (no stock movement). The
--     app must in ONE transaction: SELECT ... FOR UPDATE componentStock rows, verify stock, insert
--     batch + lines, decrement componentStock, increment availableItems, COMMIT (ROLLBACK on error).
--   * Tag log source per session: SET @app_event_source = api:production,
--   * MySQL cascaded FK deletes do not fire triggers, so they are not logged.
--   * CREATE TRIGGER needs the TRIGGER privilege (and SUPER / log_bin_trust_function_creators=1
--     if binary logging is on and the user is not root).
-- ============================================================================

-- ============================================================================
-- MySQL 001_core_schema.sql   (MySQL 8.0.16+ / 9.x, InnoDB, utf8mb4)
-- Sweety Sweet core schema (MySQL equivalent)
--
-- SAFE / NON-BLOCKING / IDEMPOTENT
--   * Every statement uses IF NOT EXISTS / OR REPLACE / ON DUPLICATE KEY.
--   * lock_wait_timeout = 5s: fails fast instead of queueing behind locks.
-- ============================================================================

SET SESSION lock_wait_timeout = 5;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  settingKey    VARCHAR(64)  PRIMARY KEY,
  settingValue  VARCHAR(255) NOT NULL,
  description   VARCHAR(255),
  updatedAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO app_settings (settingKey, settingValue, description) VALUES
  ('markup_rate',          '0.30', 'sellingPrice = costPerItem x (1 + markup_rate). Same as Angular calculateSellingPrice (30%).'),
  ('shop_commission_rate', '0.30', 'Shop share of profit. commissionAmount = (1 - rate) x profit, as product.service SHOP_COMMISSION_RATE.'),
  ('low_stock_threshold',  '5',    'v_stock_status flags a product as low stock at or below this many items.')
ON DUPLICATE KEY UPDATE settingValue = settingValue;

-- ---------------------------------------------------------------------------
-- productList (parent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productList (
  productId      INT              NOT NULL AUTO_INCREMENT,
  productName    VARCHAR(150)     NOT NULL,
  productFlavor  VARCHAR(150)     NOT NULL,
  productPrice   DOUBLE PRECISION NOT NULL DEFAULT 0,
  image_url      VARCHAR(300)     NOT NULL DEFAULT '',
  createdAt      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (productId),
  UNIQUE KEY uq_productlist_name_flavor (productName(100), productFlavor(100)),
  KEY ix_productlist_name (productName(100)),
  CONSTRAINT chk_productList_price CHECK (productPrice >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Per-product tables (all reference productList ON DELETE CASCADE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productPricing (
  productId          INT              NOT NULL,
  productSize        DOUBLE PRECISION NOT NULL DEFAULT 0,
  productQuantity    INT              NOT NULL DEFAULT 1,
  costPerItem        DOUBLE PRECISION NOT NULL DEFAULT 0,
  sellingPrice       DOUBLE PRECISION NOT NULL DEFAULT 0,
  productProfit      DOUBLE PRECISION NOT NULL DEFAULT 0,
  productCommission  DOUBLE PRECISION NOT NULL DEFAULT 0,
  itemGrouping       INT              NOT NULL DEFAULT 1,
  unitMargin         DOUBLE PRECISION GENERATED ALWAYS AS (ROUND((sellingPrice - costPerItem), 4)) STORED,
  marginPct          DOUBLE PRECISION GENERATED ALWAYS AS (CASE WHEN costPerItem > 0 THEN ROUND(((sellingPrice - costPerItem) / costPerItem * 100), 2) ELSE 0 END) STORED,
  packCost           DOUBLE PRECISION GENERATED ALWAYS AS (ROUND((costPerItem * productQuantity), 4)) STORED,
  createdAt          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (productId),
  KEY ix_productpricing_group (itemGrouping),
  CONSTRAINT fk_productPricing_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_productPricing_qty CHECK (productQuantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS availableItems (
  productId       INT      NOT NULL,
  itemsRemaining  INT      NOT NULL DEFAULT 0,
  lastUpdated     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  isOutOfStock    TINYINT  GENERATED ALWAYS AS (IF(itemsRemaining <= 0, 1, 0)) STORED,
  PRIMARY KEY (productId),
  KEY ix_availableitems_updated (lastUpdated),
  CONSTRAINT fk_availableItems_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_availableItems_remaining CHECK (itemsRemaining >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS priceTracing (
  productId  INT              NOT NULL,
  date       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accAmount  DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (productId),
  KEY ix_pricetracing_date (date),
  CONSTRAINT fk_priceTracing_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS estimates (
  productId         INT              NOT NULL,
  estimatedSelling  DOUBLE PRECISION NOT NULL DEFAULT 0,
  actualSelling     DOUBLE PRECISION NOT NULL DEFAULT 0,
  lastUpdated       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  variance          DOUBLE PRECISION GENERATED ALWAYS AS (ROUND((actualSelling - estimatedSelling), 4)) STORED,
  sellThroughPct    DOUBLE PRECISION GENERATED ALWAYS AS (CASE WHEN estimatedSelling > 0 THEN ROUND((actualSelling / estimatedSelling * 100), 2) ELSE 0 END) STORED,
  PRIMARY KEY (productId),
  KEY ix_estimates_updated (lastUpdated),
  CONSTRAINT fk_estimates_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sodEodItems (
  productId       INT          NOT NULL,
  productName     VARCHAR(150) NOT NULL DEFAULT '',
  itemsTaken      INT          NOT NULL DEFAULT 0,
  itemsRemaining  INT          NOT NULL DEFAULT 0,
  lastUpdated     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  availableItems  INT          NOT NULL DEFAULT 0,
  outOfStock      TINYINT(1)   NOT NULL DEFAULT 0,
  itemsSold       INT          GENERATED ALWAYS AS (itemsTaken - itemsRemaining) STORED,
  PRIMARY KEY (productId),
  KEY ix_sodeoditems_updated (lastUpdated),
  CONSTRAINT fk_sodEodItems_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_sodeoditems_remaining CHECK (itemsRemaining >= 0 AND itemsTaken >= 0 AND itemsRemaining <= itemsTaken)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS productItemPricing (
  productId           INT              NOT NULL,
  productDescription  VARCHAR(255)     NOT NULL DEFAULT '',
  itemGroup           INT              NOT NULL DEFAULT 1,
  itemsRemainder      INT              NOT NULL DEFAULT 0,
  costOfRemainder     DOUBLE PRECISION NOT NULL DEFAULT 0,
  groupedQuantity     INT              NOT NULL DEFAULT 0,
  groupedProfit       DOUBLE PRECISION NOT NULL DEFAULT 0,
  groupedCommission   DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (productId),
  KEY ix_productitempricing_group (itemGroup),
  CONSTRAINT fk_productItemPricing_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cartList (
  cartId         INT              NOT NULL AUTO_INCREMENT,
  productId      INT              NOT NULL,
  productName    VARCHAR(150)     NOT NULL DEFAULT '',
  productFlavor  VARCHAR(150)     NOT NULL DEFAULT '',
  productPrice   DOUBLE PRECISION NOT NULL DEFAULT 0,
  addedAt        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cartId),
  KEY ix_cartlist_product (productId),
  CONSTRAINT fk_cartList_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stockItems (
  productId        INT              NOT NULL,
  productName      VARCHAR(150)     NOT NULL DEFAULT '',
  productFlavor    VARCHAR(150)     NOT NULL DEFAULT '',
  productPrice     DOUBLE PRECISION NOT NULL DEFAULT 0,
  lastUpdated      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  productQuantity  INT              NOT NULL DEFAULT 0,
  PRIMARY KEY (productId),
  KEY ix_stockitems_updated (lastUpdated),
  CONSTRAINT fk_stockItems_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stockedItems (
  stockId        INT              NOT NULL AUTO_INCREMENT,
  productId      INT              NOT NULL,
  stockDate      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stockPrice     DOUBLE PRECISION NOT NULL DEFAULT 0,
  stockQuantity  INT              NOT NULL DEFAULT 0,
  PRIMARY KEY (stockId),
  KEY ix_stockeditems_product_date (productId, stockDate),
  CONSTRAINT fk_stockedItems_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Daily financial ledger (NO foreign key: history survives product deletion).
CREATE TABLE IF NOT EXISTS daily_financials (
  businessDate      DATE             NOT NULL,
  productId         INT              NOT NULL,
  productName       VARCHAR(150)     NOT NULL DEFAULT '',
  itemsTaken        INT              NOT NULL DEFAULT 0,
  itemsRemaining    INT              NOT NULL DEFAULT 0,
  itemsSold         INT              NOT NULL DEFAULT 0,
  sellingPrice      DOUBLE PRECISION NOT NULL DEFAULT 0,
  costPerItem       DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue           DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost              DOUBLE PRECISION NOT NULL DEFAULT 0,
  profit            DOUBLE PRECISION NOT NULL DEFAULT 0,
  commissionAmount  DOUBLE PRECISION NOT NULL DEFAULT 0,
  shopShare         DOUBLE PRECISION NOT NULL DEFAULT 0,
  recordedAt        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (businessDate, productId),
  KEY ix_daily_financials_product (productId, businessDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Reporting views (read-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_product_financials AS
SELECT
  l.productId, l.productName, l.productFlavor, l.productPrice, l.image_url,
  p.productSize, p.productQuantity, p.itemGrouping,
  p.costPerItem, p.sellingPrice, p.productProfit, p.productCommission,
  p.unitMargin, p.marginPct, p.packCost,
  ROUND((CASE WHEN p.productQuantity > 0 THEN l.productPrice / p.productQuantity ELSE 0 END), 4) AS expectedCostPerItem,
  ROUND((CASE WHEN p.productQuantity > 0 THEN l.productPrice / p.productQuantity ELSE 0 END
         * (1 + COALESCE((SELECT CAST(settingValue AS DECIMAL(18,4)) FROM app_settings WHERE settingKey = 'markup_rate'), 0.30))), 4) AS expectedSellingPrice,
  (p.productQuantity > 0 AND (
      ABS(p.costPerItem - l.productPrice / p.productQuantity) > 0.01
      OR ABS(p.sellingPrice - l.productPrice / p.productQuantity
             * (1 + COALESCE((SELECT CAST(settingValue AS DECIMAL(18,4)) FROM app_settings WHERE settingKey = 'markup_rate'), 0.30))) > 0.01
  )) AS differsFromFormula
FROM productList l
JOIN productPricing p ON p.productId = l.productId;

CREATE OR REPLACE VIEW v_stock_status AS
SELECT
  l.productId, l.productName, l.productFlavor,
  a.itemsRemaining, a.lastUpdated, a.isOutOfStock,
  (a.itemsRemaining <= COALESCE((SELECT CAST(settingValue AS SIGNED) FROM app_settings WHERE settingKey = 'low_stock_threshold'), 5)) AS isLowStock,
  ROUND((a.itemsRemaining * COALESCE(p.costPerItem, 0)), 4)  AS stockValueAtCost,
  ROUND((a.itemsRemaining * COALESCE(p.sellingPrice, 0)), 4) AS stockValueAtSelling
FROM productList l
JOIN availableItems a ON a.productId = l.productId
LEFT JOIN productPricing p ON p.productId = l.productId;

CREATE OR REPLACE VIEW v_daily_summary AS
SELECT
  businessDate,
  COUNT(*) AS products,
  SUM(itemsTaken) AS itemsTaken,
  SUM(itemsSold) AS itemsSold,
  ROUND(SUM(revenue), 4) AS revenue,
  ROUND(SUM(cost), 4) AS cost,
  ROUND(SUM(profit), 4) AS profit,
  ROUND(SUM(commissionAmount), 4) AS commissionAmount,
  ROUND(SUM(shopShare), 4) AS shopShare
FROM daily_financials
GROUP BY businessDate;

-- ---------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unitsOfMeasure (
  unitCode      VARCHAR(16)  NOT NULL,
  unitName      VARCHAR(60)  NOT NULL,
  unitType      VARCHAR(10)  NOT NULL,
  factorToBase  DOUBLE       NOT NULL DEFAULT 1,
  isActive      TINYINT(1)   NOT NULL DEFAULT 1,
  createdAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (unitCode),
  KEY ix_unitsOfMeasure_type (unitType, isActive),
  CONSTRAINT chk_unitsOfMeasure_type   CHECK (unitType IN ('MASS', 'VOLUME', 'COUNT')),
  CONSTRAINT chk_unitsOfMeasure_factor CHECK (factorToBase > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS productClassifications (
  classificationId    INT          NOT NULL AUTO_INCREMENT,
  classificationCode  VARCHAR(32)  NOT NULL,
  classificationName  VARCHAR(100) NOT NULL,
  productKind         VARCHAR(12)  NOT NULL,
  lowStockThreshold   DOUBLE       NULL,
  isActive            TINYINT(1)   NOT NULL DEFAULT 1,
  createdAt           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (classificationId),
  UNIQUE KEY uq_productClassifications_code (classificationCode),
  KEY ix_productClassifications_kind (productKind, isActive),
  CONSTRAINT chk_productClassifications_kind      CHECK (productKind IN ('FINISHED', 'COMPONENT')),
  CONSTRAINT chk_productClassifications_threshold CHECK (lowStockThreshold IS NULL OR lowStockThreshold >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO unitsOfMeasure (unitCode, unitName, unitType, factorToBase) VALUES
  ('G',   'Gram',       'MASS',   1),
  ('KG',  'Kilogram',   'MASS',   1000),
  ('ML',  'Millilitre', 'VOLUME', 1),
  ('L',   'Litre',      'VOLUME', 1000),
  ('EA',  'Each',       'COUNT',  1),
  ('PCS', 'Pieces',     'COUNT',  1)
ON DUPLICATE KEY UPDATE unitCode = unitCode;

INSERT INTO productClassifications (classificationCode, classificationName, productKind) VALUES
  ('FINISHED_GOOD', 'Finished good', 'FINISHED'),
  ('INGREDIENT',    'Ingredient',    'COMPONENT'),
  ('PACKAGING',     'Packaging',     'COMPONENT')
ON DUPLICATE KEY UPDATE classificationCode = classificationCode;

-- ---------------------------------------------------------------------------
-- Inventory profile + component stock
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productInventoryProfile (
  productId          INT          NOT NULL,
  classificationId   INT          NOT NULL,
  stockUnitCode      VARCHAR(16)  NOT NULL DEFAULT 'EA',
  lowStockThreshold  DOUBLE       NULL,
  createdAt          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (productId),
  KEY ix_productInventoryProfile_class (classificationId),
  KEY ix_productInventoryProfile_unit (stockUnitCode),
  CONSTRAINT fk_productInventoryProfile_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_productInventoryProfile_class FOREIGN KEY (classificationId)
    REFERENCES productClassifications (classificationId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_productInventoryProfile_unit FOREIGN KEY (stockUnitCode)
    REFERENCES unitsOfMeasure (unitCode) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_productInventoryProfile_threshold CHECK (lowStockThreshold IS NULL OR lowStockThreshold >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS componentStock (
  productId       INT       NOT NULL,
  quantityOnHand  DOUBLE    NOT NULL DEFAULT 0,
  createdAt       DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt       DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (productId),
  KEY ix_componentStock_qty (quantityOnHand),
  KEY ix_componentStock_updated (updatedAt),
  CONSTRAINT fk_componentStock_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_componentStock_qty CHECK (quantityOnHand >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Recipes. activeProductId = productId while isActive = 1, else NULL (trigger-maintained, see header).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
  recipeId         INT          NOT NULL AUTO_INCREMENT,
  productId        INT          NOT NULL,
  recipeName       VARCHAR(100) NOT NULL DEFAULT 'Standard',
  yieldQuantity    DOUBLE       NOT NULL DEFAULT 1,
  isActive         TINYINT(1)   NOT NULL DEFAULT 1,
  notes            VARCHAR(255) NULL,
  activeProductId  INT          NULL,
  createdAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (recipeId),
  UNIQUE KEY uq_recipes_product_name (productId, recipeName),
  UNIQUE KEY uq_recipes_one_active (activeProductId),
  CONSTRAINT fk_recipes_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_recipes_yield  CHECK (yieldQuantity > 0),
  CONSTRAINT chk_recipes_active CHECK (isActive IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recipeComponents (
  recipeComponentId   INT          NOT NULL AUTO_INCREMENT,
  recipeId            INT          NOT NULL,
  componentProductId  INT          NOT NULL,
  quantityRequired    DOUBLE       NOT NULL,
  unitCode            VARCHAR(16)  NOT NULL,
  createdAt           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (recipeComponentId),
  UNIQUE KEY uq_recipeComponents_recipe_component (recipeId, componentProductId),
  KEY ix_recipeComponents_component (componentProductId),
  KEY ix_recipeComponents_unit (unitCode),
  CONSTRAINT fk_recipeComponents_recipe FOREIGN KEY (recipeId)
    REFERENCES recipes (recipeId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_recipeComponents_component FOREIGN KEY (componentProductId)
    REFERENCES productList (productId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_recipeComponents_unit FOREIGN KEY (unitCode)
    REFERENCES unitsOfMeasure (unitCode) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_recipeComponents_qty CHECK (quantityRequired > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Production ledger (does NOT move stock)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productionBatches (
  batchId           INT          NOT NULL AUTO_INCREMENT,
  productId         INT          NOT NULL,
  productName       VARCHAR(150) NOT NULL DEFAULT '',
  recipeId          INT          NULL,
  quantityProduced  DOUBLE       NOT NULL,
  status            VARCHAR(12)  NOT NULL DEFAULT 'COMPLETED',
  producedAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes             VARCHAR(255) NULL,
  createdAt         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (batchId),
  KEY ix_productionBatches_product_date (productId, producedAt),
  KEY ix_productionBatches_status (status, producedAt),
  KEY ix_productionBatches_recipe (recipeId),
  CONSTRAINT fk_productionBatches_product FOREIGN KEY (productId)
    REFERENCES productList (productId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_productionBatches_recipe FOREIGN KEY (recipeId)
    REFERENCES recipes (recipeId) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_productionBatches_qty    CHECK (quantityProduced > 0),
  CONSTRAINT chk_productionBatches_status CHECK (status IN ('PLANNED', 'COMPLETED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS productionBatchComponents (
  batchComponentId    INT          NOT NULL AUTO_INCREMENT,
  batchId             INT          NOT NULL,
  componentProductId  INT          NOT NULL,
  quantityConsumed    DOUBLE       NOT NULL,
  unitCode            VARCHAR(16)  NOT NULL,
  createdAt           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batchComponentId),
  UNIQUE KEY uq_productionBatchComponents_batch_component (batchId, componentProductId),
  KEY ix_productionBatchComponents_component (componentProductId),
  KEY ix_productionBatchComponents_unit (unitCode),
  CONSTRAINT fk_productionBatchComponents_batch FOREIGN KEY (batchId)
    REFERENCES productionBatches (batchId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_productionBatchComponents_component FOREIGN KEY (componentProductId)
    REFERENCES productList (productId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_productionBatchComponents_unit FOREIGN KEY (unitCode)
    REFERENCES unitsOfMeasure (unitCode) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_productionBatchComponents_qty CHECK (quantityConsumed >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Observability: append-only event log (NO foreign keys)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventoryEventLog (
  eventId         INT           NOT NULL AUTO_INCREMENT,
  eventType       VARCHAR(40)   NOT NULL,
  entityType      VARCHAR(40)   NOT NULL,
  productId       INT           NULL,
  batchId         INT           NULL,
  recipeId        INT           NULL,
  quantityBefore  DOUBLE        NULL,
  quantityAfter   DOUBLE        NULL,
  quantityDelta   DOUBLE        NULL,
  unitCode        VARCHAR(16)   NULL,
  source          VARCHAR(60)   NOT NULL DEFAULT 'DB_TRIGGER',
  detail          VARCHAR(500)  NULL,
  createdAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (eventId),
  KEY ix_inventoryEventLog_product (productId, createdAt),
  KEY ix_inventoryEventLog_type (eventType, createdAt),
  KEY ix_inventoryEventLog_batch (batchId),
  KEY ix_inventoryEventLog_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Triggers (single-statement bodies, drop/create touches only this files triggers)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_recipes_active_ins;
CREATE TRIGGER trg_recipes_active_ins BEFORE INSERT ON recipes FOR EACH ROW
  SET NEW.activeProductId = IF(NEW.isActive = 1, NEW.productId, NULL);

DROP TRIGGER IF EXISTS trg_recipes_active_upd;
CREATE TRIGGER trg_recipes_active_upd BEFORE UPDATE ON recipes FOR EACH ROW
  SET NEW.activeProductId = IF(NEW.isActive = 1, NEW.productId, NULL);

DROP TRIGGER IF EXISTS trg_componentStock_log_ins;
CREATE TRIGGER trg_componentStock_log_ins AFTER INSERT ON componentStock FOR EACH ROW
  INSERT INTO inventoryEventLog (eventType, entityType, productId, quantityBefore, quantityAfter, quantityDelta, unitCode, source)
  VALUES ('COMPONENT_STOCK_CREATED', 'componentStock', NEW.productId, NULL, NEW.quantityOnHand, NEW.quantityOnHand,
          (SELECT pip.stockUnitCode FROM productInventoryProfile pip WHERE pip.productId = NEW.productId),
          COALESCE(@app_event_source, 'DB_TRIGGER'));

DROP TRIGGER IF EXISTS trg_componentStock_log_upd;
CREATE TRIGGER trg_componentStock_log_upd AFTER UPDATE ON componentStock FOR EACH ROW
  INSERT INTO inventoryEventLog (eventType, entityType, productId, quantityBefore, quantityAfter, quantityDelta, unitCode, source)
  SELECT 'COMPONENT_STOCK_CHANGED', 'componentStock', NEW.productId, OLD.quantityOnHand, NEW.quantityOnHand,
         NEW.quantityOnHand - OLD.quantityOnHand,
         (SELECT pip.stockUnitCode FROM productInventoryProfile pip WHERE pip.productId = NEW.productId),
         COALESCE(@app_event_source, 'DB_TRIGGER')
  FROM DUAL WHERE NOT (NEW.quantityOnHand <=> OLD.quantityOnHand);

DROP TRIGGER IF EXISTS trg_productionBatches_log_ins;
CREATE TRIGGER trg_productionBatches_log_ins AFTER INSERT ON productionBatches FOR EACH ROW
  INSERT INTO inventoryEventLog (eventType, entityType, productId, batchId, recipeId, quantityAfter, quantityDelta, source, detail)
  VALUES ('PRODUCTION_BATCH_RECORDED', 'productionBatches', NEW.productId, NEW.batchId, NEW.recipeId,
          NEW.quantityProduced, NEW.quantityProduced, COALESCE(@app_event_source, 'DB_TRIGGER'),
          CONCAT('status=', NEW.status));

DROP TRIGGER IF EXISTS trg_productionBatches_log_upd;
CREATE TRIGGER trg_productionBatches_log_upd AFTER UPDATE ON productionBatches FOR EACH ROW
  INSERT INTO inventoryEventLog (eventType, entityType, productId, batchId, recipeId, quantityAfter, source, detail)
  SELECT 'PRODUCTION_BATCH_STATUS_CHANGED', 'productionBatches', NEW.productId, NEW.batchId, NEW.recipeId,
         NEW.quantityProduced, COALESCE(@app_event_source, 'DB_TRIGGER'),
         CONCAT(OLD.status, ' -> ', NEW.status)
  FROM DUAL WHERE NOT (NEW.status <=> OLD.status);

-- ---------------------------------------------------------------------------
-- Views (read-only, numbers DOUBLE, flags 0/1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_default_low_stock_threshold AS
SELECT COALESCE((SELECT CAST(s.settingValue AS DECIMAL(18,4)) FROM app_settings s WHERE s.settingKey = 'low_stock_threshold'), 5) * 1.0e0 AS thresholdValue;

CREATE OR REPLACE VIEW v_recipe_requirements AS
SELECT
  r.recipeId, r.productId, fp.productName, fp.productFlavor,
  pp.productSize AS productSize,
  CASE pp.productSize WHEN 10 THEN 'Ten' WHEN 100 THEN 'Hundred' WHEN 1000 THEN 'Thousand' ELSE NULL END AS sizeLabel,
  r.recipeName, r.isActive, r.yieldQuantity,
  rc.recipeComponentId, rc.componentProductId,
  cp.productName AS componentName, cp.productFlavor AS componentFlavor,
  rc.quantityRequired, rc.unitCode
FROM recipes r
JOIN productList fp ON fp.productId = r.productId
LEFT JOIN productPricing pp ON pp.productId = r.productId
LEFT JOIN recipeComponents rc ON rc.recipeId = r.recipeId
LEFT JOIN productList cp ON cp.productId = rc.componentProductId;

CREATE OR REPLACE VIEW v_component_stock_status AS
SELECT
  l.productId, l.productName, l.productFlavor,
  pc.classificationCode, pip.stockUnitCode AS unitCode,
  COALESCE(cs.quantityOnHand, 0) AS quantityOnHand,
  CASE WHEN cs.productId IS NULL THEN 1 ELSE 0 END AS missingStockRow,
  COALESCE(pip.lowStockThreshold, pc.lowStockThreshold, d.thresholdValue) AS lowStockThreshold,
  CASE WHEN COALESCE(cs.quantityOnHand, 0) <= 0 THEN 1 ELSE 0 END AS isOutOfStock,
  CASE WHEN COALESCE(cs.quantityOnHand, 0) <= COALESCE(pip.lowStockThreshold, pc.lowStockThreshold, d.thresholdValue)
       THEN 1 ELSE 0 END AS isLowStock
FROM productInventoryProfile pip
JOIN productClassifications pc ON pc.classificationId = pip.classificationId AND pc.productKind = 'COMPONENT'
JOIN productList l ON l.productId = pip.productId
LEFT JOIN componentStock cs ON cs.productId = pip.productId
CROSS JOIN v_default_low_stock_threshold d;

CREATE OR REPLACE VIEW v_inventory_status AS
SELECT
  'FINISHED' AS inventoryKind, l.productId, l.productName, l.productFlavor,
  COALESCE(pip.stockUnitCode, 'EA') AS unitCode,
  a.itemsRemaining * 1.0e0 AS quantityOnHand,
  COALESCE(pip.lowStockThreshold, pc.lowStockThreshold, d.thresholdValue) AS lowStockThreshold,
  CASE WHEN a.itemsRemaining <= 0 THEN 1 ELSE 0 END AS isOutOfStock,
  CASE WHEN a.itemsRemaining <= COALESCE(pip.lowStockThreshold, pc.lowStockThreshold, d.thresholdValue) THEN 1 ELSE 0 END AS isLowStock,
  CASE WHEN a.itemsRemaining <= 0 THEN 'OUT_OF_STOCK'
       WHEN a.itemsRemaining <= COALESCE(pip.lowStockThreshold, pc.lowStockThreshold, d.thresholdValue) THEN 'LOW'
       ELSE 'OK' END AS stockState
FROM productList l
JOIN availableItems a ON a.productId = l.productId
LEFT JOIN productInventoryProfile pip ON pip.productId = l.productId
LEFT JOIN productClassifications pc ON pc.classificationId = pip.classificationId
CROSS JOIN v_default_low_stock_threshold d
WHERE COALESCE(pc.productKind, 'FINISHED') = 'FINISHED'
UNION ALL
SELECT
  'COMPONENT', c.productId, c.productName, c.productFlavor, c.unitCode,
  c.quantityOnHand, c.lowStockThreshold, c.isOutOfStock, c.isLowStock,
  CASE WHEN c.isOutOfStock = 1 THEN 'OUT_OF_STOCK' WHEN c.isLowStock = 1 THEN 'LOW' ELSE 'OK' END
FROM v_component_stock_status c;

CREATE OR REPLACE VIEW v_recipe_component_capacity AS
SELECT
  x.*,
  ROW_NUMBER() OVER (PARTITION BY x.recipeId ORDER BY x.capacityItems ASC, x.recipeComponentId ASC) AS limitRank
FROM (
  SELECT
    r.recipeId, r.productId, rc.recipeComponentId, rc.componentProductId,
    cp.productName AS componentName, rc.unitCode AS recipeUnitCode, pip.stockUnitCode AS stockUnitCode,
    rc.quantityRequired AS quantityRequired, r.yieldQuantity AS yieldQuantity,
    COALESCE(cs.quantityOnHand, 0) AS quantityOnHand,
    CASE WHEN pip.productId IS NULL THEN 'NO_INVENTORY_PROFILE'
         WHEN ru.unitType <> su.unitType THEN 'UNIT_MISMATCH'
         WHEN cs.productId IS NULL THEN 'NO_STOCK_RECORD'
         ELSE 'OK' END AS lineStatus,
    CASE WHEN pip.productId IS NULL OR ru.unitType <> su.unitType THEN 0
         ELSE FLOOR(ROUND(COALESCE(cs.quantityOnHand, 0) * su.factorToBase * r.yieldQuantity
                          / (rc.quantityRequired * ru.factorToBase), 6)) END * 1.0e0 AS capacityItems
  FROM recipes r
  JOIN recipeComponents rc ON rc.recipeId = r.recipeId
  JOIN productList cp ON cp.productId = rc.componentProductId
  JOIN unitsOfMeasure ru ON ru.unitCode = rc.unitCode
  LEFT JOIN productInventoryProfile pip ON pip.productId = rc.componentProductId
  LEFT JOIN unitsOfMeasure su ON su.unitCode = pip.stockUnitCode
  LEFT JOIN componentStock cs ON cs.productId = rc.componentProductId
  WHERE r.isActive = 1
) x;

CREATE OR REPLACE VIEW v_production_capacity AS
SELECT
  r.productId, fp.productName, fp.productFlavor, r.recipeId, r.recipeName,
  r.yieldQuantity AS yieldQuantity,
  (SELECT COUNT(*) FROM recipeComponents n WHERE n.recipeId = r.recipeId) * 1.0e0 AS componentCount,
  COALESCE(lim.capacityItems, 0) AS maxProducible,
  lim.componentProductId AS limitingComponentId,
  lim.componentName      AS limitingComponentName,
  lim.stockUnitCode      AS limitingUnitCode,
  lim.quantityOnHand     AS limitingQuantityOnHand,
  CASE WHEN lim.recipeId IS NULL THEN 'NO_COMPONENTS' ELSE lim.lineStatus END AS capacityStatus,
  COALESCE(a.itemsRemaining, 0) * 1.0e0 AS finishedStock,
  (COALESCE(a.itemsRemaining, 0) + COALESCE(lim.capacityItems, 0)) * 1.0e0 AS totalAvailable,
  CASE WHEN COALESCE(a.itemsRemaining, 0) <= 0 THEN 1 ELSE 0 END AS finishedOutOfStock,
  CASE WHEN COALESCE(lim.capacityItems, 0) > 0 THEN 1 ELSE 0 END AS canProduce
FROM recipes r
JOIN productList fp ON fp.productId = r.productId
LEFT JOIN v_recipe_component_capacity lim ON lim.recipeId = r.recipeId AND lim.limitRank = 1
LEFT JOIN availableItems a ON a.productId = r.productId
WHERE r.isActive = 1;

CREATE OR REPLACE VIEW v_recipe_issues AS
SELECT 'FINISHED_WITHOUT_ACTIVE_RECIPE' AS issueType, NULL AS recipeId, l.productId, l.productName,
       NULL AS componentProductId, NULL AS componentName, 'Finished product has no active recipe' AS detail
FROM productInventoryProfile pip
JOIN productClassifications pc ON pc.classificationId = pip.classificationId AND pc.productKind = 'FINISHED'
JOIN productList l ON l.productId = pip.productId
WHERE NOT EXISTS (SELECT 1 FROM recipes r WHERE r.productId = pip.productId AND r.isActive = 1)
UNION ALL
SELECT 'RECIPE_WITHOUT_COMPONENTS', r.recipeId, r.productId, l.productName, NULL, NULL,
       'Active recipe has no component lines'
FROM recipes r
JOIN productList l ON l.productId = r.productId
WHERE r.isActive = 1 AND NOT EXISTS (SELECT 1 FROM recipeComponents rc WHERE rc.recipeId = r.recipeId)
UNION ALL
SELECT 'SELF_REFERENCE', r.recipeId, r.productId, l.productName, rc.componentProductId, l.productName,
       'A product is listed as a component of itself'
FROM recipes r
JOIN recipeComponents rc ON rc.recipeId = r.recipeId AND rc.componentProductId = r.productId
JOIN productList l ON l.productId = r.productId
UNION ALL
SELECT 'COMPONENT_NOT_CLASSIFIED', r.recipeId, r.productId, fp.productName, rc.componentProductId, cp.productName,
       'Component has no productInventoryProfile (no stock unit / classification)'
FROM recipes r
JOIN recipeComponents rc ON rc.recipeId = r.recipeId
JOIN productList fp ON fp.productId = r.productId
JOIN productList cp ON cp.productId = rc.componentProductId
LEFT JOIN productInventoryProfile pip ON pip.productId = rc.componentProductId
WHERE r.isActive = 1 AND pip.productId IS NULL
UNION ALL
SELECT 'COMPONENT_KIND_MISMATCH', r.recipeId, r.productId, fp.productName, rc.componentProductId, cp.productName,
       CONCAT('Component is classified ', pc.classificationCode, ', not a COMPONENT class')
FROM recipes r
JOIN recipeComponents rc ON rc.recipeId = r.recipeId
JOIN productList fp ON fp.productId = r.productId
JOIN productList cp ON cp.productId = rc.componentProductId
JOIN productInventoryProfile pip ON pip.productId = rc.componentProductId
JOIN productClassifications pc ON pc.classificationId = pip.classificationId AND pc.productKind <> 'COMPONENT'
WHERE r.isActive = 1
UNION ALL
SELECT 'UNIT_MISMATCH', c.recipeId, c.productId, fp.productName, c.componentProductId, c.componentName,
       CONCAT('Recipe unit ', c.recipeUnitCode, ' cannot be converted to stock unit ', c.stockUnitCode)
FROM v_recipe_component_capacity c
JOIN productList fp ON fp.productId = c.productId
WHERE c.lineStatus = 'UNIT_MISMATCH'
UNION ALL
SELECT 'NO_STOCK_RECORD', c.recipeId, c.productId, fp.productName, c.componentProductId, c.componentName,
       'Component has no componentStock row (treated as 0 on hand)'
FROM v_recipe_component_capacity c
JOIN productList fp ON fp.productId = c.productId
WHERE c.lineStatus = 'NO_STOCK_RECORD';

CREATE OR REPLACE VIEW v_inventory_event_daily AS
SELECT
  DATE(createdAt) AS eventDate, eventType,
  COUNT(*) * 1.0e0 AS eventCount,
  ROUND(SUM(quantityDelta), 4) AS quantityDeltaTotal
FROM inventoryEventLog
GROUP BY DATE(createdAt), eventType;

-- ============================================================================
-- READ-ONLY CHECKS (commented out)
-- ============================================================================
-- SELECT * FROM v_recipe_issues ORDER BY issueType, productName,
-- SELECT * FROM v_inventory_status WHERE stockState <> OK,
-- SELECT productName, maxProducible, capacityStatus, limitingComponentName FROM v_production_capacity,
-- SELECT * FROM inventoryEventLog ORDER BY eventId DESC LIMIT 50,