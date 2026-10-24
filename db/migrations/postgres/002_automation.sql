-- ============================================================================
-- PostgreSQL 002_automation.sql - triggers that populate values automatically.
-- Same rules as the MySQL version: values the API supplies are ALWAYS kept; a trigger only fills
-- a value the API left as 0 / blank, using the app's formulas:
--   costPerItem       = productList.productPrice / productQuantity
--   sellingPrice      = costPerItem x (1 + markup_rate)                (default 30%)
--   productProfit     = productQuantity x sellingPrice
--   productCommission = productProfit - costPerItem x productQuantity
-- and every sodEodItems insert/update upserts the day's row in daily_financials:
--   sold = itemsTaken - itemsRemaining;  revenue = sold x sellingPrice;  cost = sold x costPerItem
--   profit = sold x (sellingPrice - costPerItem);  commissionAmount = (1 - shop_commission_rate) x profit
--   shopShare = shop_commission_rate x profit
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_productlist_prepare() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."productId" IS NOT NULL THEN
    -- keep the sequence ahead of explicitly supplied ids (the app generates ids itself)
    PERFORM setval('productlist_productid_seq', GREATEST(NEW."productId", (SELECT last_value FROM productlist_productid_seq)));
  END IF;
  IF NEW.image_url IS NULL OR btrim(NEW.image_url) = '' THEN
    NEW.image_url := btrim(NEW."productName") || ' ' || btrim(NEW."productFlavor") || '.webp';
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_productpricing_autofill() RETURNS trigger AS $fn$
DECLARE
  v_price  DOUBLE PRECISION;
  v_markup DOUBLE PRECISION;
BEGIN
  SELECT "productPrice" INTO v_price FROM productList WHERE "productId" = NEW."productId";
  SELECT "settingValue"::double precision INTO v_markup FROM app_settings WHERE "settingKey" = 'markup_rate';
  v_markup := COALESCE(v_markup, 0.30);
  IF COALESCE(NEW."costPerItem", 0) = 0 AND COALESCE(NEW."productQuantity", 0) > 0 AND v_price IS NOT NULL THEN
    NEW."costPerItem" := v_price / NEW."productQuantity";
  END IF;
  IF COALESCE(NEW."sellingPrice", 0) = 0 THEN
    NEW."sellingPrice" := COALESCE(NEW."costPerItem", 0) * (1 + v_markup);
  END IF;
  IF COALESCE(NEW."productProfit", 0) = 0 THEN
    NEW."productProfit" := COALESCE(NEW."productQuantity", 0) * NEW."sellingPrice";
  END IF;
  IF COALESCE(NEW."productCommission", 0) = 0 THEN
    NEW."productCommission" := NEW."productProfit" - COALESCE(NEW."costPerItem", 0) * COALESCE(NEW."productQuantity", 0);
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_fill_names_from_product() RETURNS trigger AS $fn$
DECLARE
  v_name   TEXT;
  v_flavor TEXT;
BEGIN
  SELECT "productName", "productFlavor" INTO v_name, v_flavor FROM productList WHERE "productId" = NEW."productId";
  IF TG_TABLE_NAME = 'sodeoditems' THEN
    IF NEW."productName" IS NULL OR btrim(NEW."productName") = '' THEN NEW."productName" := COALESCE(v_name, ''); END IF;
  ELSIF TG_TABLE_NAME = 'productitempricing' THEN
    IF NEW."productDescription" IS NULL OR btrim(NEW."productDescription") = '' THEN NEW."productDescription" := COALESCE(v_name, ''); END IF;
  ELSE  -- cartlist, stockitems
    IF NEW."productName" IS NULL OR btrim(NEW."productName") = '' THEN NEW."productName" := COALESCE(v_name, ''); END IF;
    IF NEW."productFlavor" IS NULL OR btrim(NEW."productFlavor") = '' THEN NEW."productFlavor" := COALESCE(v_flavor, ''); END IF;
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_stockeditems_sync_seq() RETURNS trigger AS $fn$
BEGIN
  IF NEW."stockId" IS NOT NULL THEN
    PERFORM setval('stockeditems_stockid_seq', GREATEST(NEW."stockId", (SELECT last_value FROM stockeditems_stockid_seq)));
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_sodeod_to_daily_financials() RETURNS trigger AS $fn$
DECLARE
  v_selling DOUBLE PRECISION := 0;
  v_cost    DOUBLE PRECISION := 0;
  v_rate    DOUBLE PRECISION;
  v_sold    INTEGER;
  v_profit  DOUBLE PRECISION;
BEGIN
  SELECT "sellingPrice", "costPerItem" INTO v_selling, v_cost FROM productPricing WHERE "productId" = NEW."productId";
  SELECT "settingValue"::double precision INTO v_rate FROM app_settings WHERE "settingKey" = 'shop_commission_rate';
  v_rate    := COALESCE(v_rate, 0.30);
  v_selling := COALESCE(v_selling, 0);
  v_cost    := COALESCE(v_cost, 0);
  v_sold    := GREATEST(COALESCE(NEW."itemsTaken", 0) - COALESCE(NEW."itemsRemaining", 0), 0);
  v_profit  := v_sold * (v_selling - v_cost);
  INSERT INTO daily_financials
    ("businessDate", "productId", "productName", "itemsTaken", "itemsRemaining", "itemsSold",
     "sellingPrice", "costPerItem", revenue, cost, profit, "commissionAmount", "shopShare")
  VALUES
    (COALESCE(NEW."lastUpdated", now())::date, NEW."productId", COALESCE(NEW."productName", ''),
     COALESCE(NEW."itemsTaken", 0), COALESCE(NEW."itemsRemaining", 0), v_sold,
     v_selling, v_cost,
     round((v_sold * v_selling)::numeric, 4)::double precision,
     round((v_sold * v_cost)::numeric, 4)::double precision,
     round(v_profit::numeric, 4)::double precision,
     round(((1 - v_rate) * v_profit)::numeric, 4)::double precision,
     round((v_rate * v_profit)::numeric, 4)::double precision)
  ON CONFLICT ("businessDate", "productId") DO UPDATE SET
    "productName" = EXCLUDED."productName", "itemsTaken" = EXCLUDED."itemsTaken",
    "itemsRemaining" = EXCLUDED."itemsRemaining", "itemsSold" = EXCLUDED."itemsSold",
    "sellingPrice" = EXCLUDED."sellingPrice", "costPerItem" = EXCLUDED."costPerItem",
    revenue = EXCLUDED.revenue, cost = EXCLUDED.cost, profit = EXCLUDED.profit,
    "commissionAmount" = EXCLUDED."commissionAmount", "shopShare" = EXCLUDED."shopShare",
    "updatedAt" = now();
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_productlist_prepare ON productList;
CREATE TRIGGER trg_productlist_prepare BEFORE INSERT OR UPDATE ON productList
  FOR EACH ROW EXECUTE FUNCTION fn_productlist_prepare();

DROP TRIGGER IF EXISTS trg_productpricing_autofill ON productPricing;
CREATE TRIGGER trg_productpricing_autofill BEFORE INSERT OR UPDATE ON productPricing
  FOR EACH ROW EXECUTE FUNCTION fn_productpricing_autofill();

DROP TRIGGER IF EXISTS trg_sodeoditems_names ON sodEodItems;
CREATE TRIGGER trg_sodeoditems_names BEFORE INSERT ON sodEodItems
  FOR EACH ROW EXECUTE FUNCTION fn_fill_names_from_product();

DROP TRIGGER IF EXISTS trg_productitempricing_names ON productItemPricing;
CREATE TRIGGER trg_productitempricing_names BEFORE INSERT ON productItemPricing
  FOR EACH ROW EXECUTE FUNCTION fn_fill_names_from_product();

DROP TRIGGER IF EXISTS trg_cartlist_names ON cartList;
CREATE TRIGGER trg_cartlist_names BEFORE INSERT ON cartList
  FOR EACH ROW EXECUTE FUNCTION fn_fill_names_from_product();

DROP TRIGGER IF EXISTS trg_stockitems_names ON stockItems;
CREATE TRIGGER trg_stockitems_names BEFORE INSERT ON stockItems
  FOR EACH ROW EXECUTE FUNCTION fn_fill_names_from_product();

DROP TRIGGER IF EXISTS trg_stockeditems_seq ON stockedItems;
CREATE TRIGGER trg_stockeditems_seq BEFORE INSERT ON stockedItems
  FOR EACH ROW EXECUTE FUNCTION fn_stockeditems_sync_seq();

DROP TRIGGER IF EXISTS trg_sodeoditems_ledger ON sodEodItems;
CREATE TRIGGER trg_sodeoditems_ledger AFTER INSERT OR UPDATE ON sodEodItems
  FOR EACH ROW EXECUTE FUNCTION fn_sodeod_to_daily_financials();

DROP TRIGGER IF EXISTS trg_app_settings_touch ON app_settings;
CREATE TRIGGER trg_app_settings_touch BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_daily_financials_touch ON daily_financials;
CREATE TRIGGER trg_daily_financials_touch BEFORE UPDATE ON daily_financials
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ============================================================================
-- PostgreSQL 003_recipes_inventory_production.sql   (PostgreSQL 12+)
-- Recipes, component inventory, production ledger, capacity views, observability log.
-- FAULT TOLERANT + NON-BLOCKING + IDEMPOTENT (same model as 001):
--   * every statement runs via fn_mig_try(): errors are caught, logged to schema_migration_skips
--     and never abort the migration; lock_timeout 5s means it never queues behind the API.
--   * new tables are created WITHOUT inline foreign keys, then FKs are added one by one by
--     fn_mig_fk() only if missing. A mismatch on productList therefore skips just that FK and
--     the tables, triggers and reference data are still created.
--   * no BEGIN/COMMIT: safe with or without a runner-managed transaction.
--   * views are replaced atomically (CREATE OR REPLACE, else drop + recreate, never CASCADE).
-- Diagnose: SELECT * FROM schema_migration_skips ORDER BY id DESC;
--
-- BUSINESS RULES
--   * productPricing."productSize" (10/100/1000) is a LABEL ONLY; never drives stock or yield.
--   * Finished stock stays in availableItems; component stock lives in componentstock.
--   * Units only for components (G, KG, ML, L, EA, PCS). MASS<->VOLUME not converted:
--     flagged UNIT_MISMATCH, capacity 0.
--   * productionBatches / productionBatchComponents are a LEDGER ONLY (no stock movement). The app
--     must in ONE transaction: SELECT ... FOR UPDATE componentStock rows, verify stock, insert
--     batch + lines, decrement componentStock, increment availableItems, COMMIT (ROLLBACK on error).
--   * Tag log source per transaction:  SET LOCAL app.event_source = 'api:production';
--   * No business data seeded, only reference rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migration_skips (
  id            INTEGER   GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  "objectName"  VARCHAR(200),
  "errorMessage" TEXT,
  "skippedAt"   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION fn_mig_try(p_sql text, p_view text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $mig$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF p_view IS NOT NULL THEN
      BEGIN
        EXECUTE format('DROP VIEW IF EXISTS %s', p_view);
        EXECUTE p_sql;
        RETURN;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    RAISE NOTICE '[mig] skipped %: %', left(regexp_replace(p_sql, '\s+', ' ', 'g'), 80), SQLERRM;
    BEGIN
      INSERT INTO schema_migration_skips ("objectName", "errorMessage")
      VALUES (COALESCE(p_view, left(regexp_replace(p_sql, '\s+', ' ', 'g'), 200)), SQLERRM);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
END
$mig$;

-- Adds a foreign key only when the table exists and the constraint is not already there.
CREATE OR REPLACE FUNCTION fn_mig_fk(p_table text, p_name text, p_def text) RETURNS void
LANGUAGE plpgsql AS $mig$
BEGIN
  IF to_regclass(p_table) IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p_name AND conrelid = to_regclass(p_table)) THEN RETURN; END IF;
  PERFORM fn_mig_try(format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table, p_name, p_def));
END
$mig$;

-- updatedAt maintenance (specific to 003)
SELECT fn_mig_try($q$
CREATE OR REPLACE FUNCTION fn_003_touch_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql$q$);

-- ---------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------
SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS unitsOfMeasure (
  "unitCode"      VARCHAR(16)      NOT NULL,
  "unitName"      VARCHAR(60)      NOT NULL,
  "unitType"      VARCHAR(10)      NOT NULL,
  "factorToBase"  DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isActive"      BOOLEAN          NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_unitsofmeasure PRIMARY KEY ("unitCode"),
  CONSTRAINT chk_unitsofmeasure_type   CHECK ("unitType" IN ('MASS', 'VOLUME', 'COUNT')),
  CONSTRAINT chk_unitsofmeasure_factor CHECK ("factorToBase" > 0)
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_unitsofmeasure_type ON unitsOfMeasure ("unitType", "isActive")$q$);

SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS productClassifications (
  "classificationId"    INTEGER          GENERATED BY DEFAULT AS IDENTITY,
  "classificationCode"  VARCHAR(32)      NOT NULL,
  "classificationName"  VARCHAR(100)     NOT NULL,
  "productKind"         VARCHAR(12)      NOT NULL,
  "lowStockThreshold"   DOUBLE PRECISION NULL,
  "isActive"            BOOLEAN          NOT NULL DEFAULT TRUE,
  "createdAt"           TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_productclassifications PRIMARY KEY ("classificationId"),
  CONSTRAINT uq_productclassifications_code UNIQUE ("classificationCode"),
  CONSTRAINT chk_productclassifications_kind      CHECK ("productKind" IN ('FINISHED', 'COMPONENT')),
  CONSTRAINT chk_productclassifications_threshold CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0)
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productclassifications_kind ON productClassifications ("productKind", "isActive")$q$);

SELECT fn_mig_try($q$
INSERT INTO unitsOfMeasure ("unitCode", "unitName", "unitType", "factorToBase") VALUES
  ('G',   'Gram',       'MASS',   1),
  ('KG',  'Kilogram',   'MASS',   1000),
  ('ML',  'Millilitre', 'VOLUME', 1),
  ('L',   'Litre',      'VOLUME', 1000),
  ('EA',  'Each',       'COUNT',  1),
  ('PCS', 'Pieces',     'COUNT',  1)
ON CONFLICT ("unitCode") DO NOTHING$q$);

SELECT fn_mig_try($q$
INSERT INTO productClassifications ("classificationCode", "classificationName", "productKind") VALUES
  ('FINISHED_GOOD', 'Finished good', 'FINISHED'),
  ('INGREDIENT',    'Ingredient',    'COMPONENT'),
  ('PACKAGING',     'Packaging',     'COMPONENT')
ON CONFLICT ("classificationCode") DO NOTHING$q$);

-- ---------------------------------------------------------------------------
-- Inventory profile + component stock
-- ---------------------------------------------------------------------------
SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS productInventoryProfile (
  "productId"          INTEGER          NOT NULL,
  "classificationId"   INTEGER          NOT NULL,
  "stockUnitCode"      VARCHAR(16)      NOT NULL DEFAULT 'EA',
  "lowStockThreshold"  DOUBLE PRECISION NULL,
  "createdAt"          TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_productinventoryprofile PRIMARY KEY ("productId"),
  CONSTRAINT chk_productinventoryprofile_threshold CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0)
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productinventoryprofile_class ON productInventoryProfile ("classificationId")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productinventoryprofile_unit  ON productInventoryProfile ("stockUnitCode")$q$);

SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS componentStock (
  "productId"       INTEGER          NOT NULL,
  "quantityOnHand"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_componentstock PRIMARY KEY ("productId"),
  CONSTRAINT chk_componentstock_qty CHECK ("quantityOnHand" >= 0)
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_componentstock_qty     ON componentStock ("quantityOnHand")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_componentstock_updated ON componentStock ("updatedAt")$q$);

-- ---------------------------------------------------------------------------
-- Recipes (at most ONE active recipe per product)
-- ---------------------------------------------------------------------------
SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS recipes (
  "recipeId"       INTEGER          GENERATED BY DEFAULT AS IDENTITY,
  "productId"      INTEGER          NOT NULL,
  "recipeName"     VARCHAR(100)     NOT NULL DEFAULT 'Standard',
  "yieldQuantity"  DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isActive"       BOOLEAN          NOT NULL DEFAULT TRUE,
  notes            VARCHAR(255)     NULL,
  "createdAt"      TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_recipes PRIMARY KEY ("recipeId"),
  CONSTRAINT uq_recipes_product_name UNIQUE ("productId", "recipeName"),
  CONSTRAINT chk_recipes_yield CHECK ("yieldQuantity" > 0)
)$q$);
SELECT fn_mig_try($q$CREATE UNIQUE INDEX IF NOT EXISTS uq_recipes_one_active ON recipes ("productId") WHERE "isActive"$q$);

SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS recipeComponents (
  "recipeComponentId"   INTEGER          GENERATED BY DEFAULT AS IDENTITY,
  "recipeId"            INTEGER          NOT NULL,
  "componentProductId"  INTEGER          NOT NULL,
  "quantityRequired"    DOUBLE PRECISION NOT NULL,
  "unitCode"            VARCHAR(16)      NOT NULL,
  "createdAt"           TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_recipecomponents PRIMARY KEY ("recipeComponentId"),
  CONSTRAINT uq_recipecomponents_recipe_component UNIQUE ("recipeId", "componentProductId"),
  CONSTRAINT chk_recipecomponents_qty CHECK ("quantityRequired" > 0)
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_recipecomponents_component ON recipeComponents ("componentProductId")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_recipecomponents_unit      ON recipeComponents ("unitCode")$q$);

-- ---------------------------------------------------------------------------
-- Production ledger (does NOT move stock)
-- ---------------------------------------------------------------------------
SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS productionBatches (
  "batchId"           INTEGER          GENERATED BY DEFAULT AS IDENTITY,
  "productId"         INTEGER          NOT NULL,
  "productName"       VARCHAR(150)     NOT NULL DEFAULT '',
  "recipeId"          INTEGER          NULL,
  "quantityProduced"  DOUBLE PRECISION NOT NULL,
  status              VARCHAR(12)      NOT NULL DEFAULT 'COMPLETED',
  "producedAt"        TIMESTAMP        NOT NULL DEFAULT now(),
  notes               VARCHAR(255)     NULL,
  "createdAt"         TIMESTAMP        NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_productionbatches PRIMARY KEY ("batchId"),
  CONSTRAINT chk_productionbatches_qty    CHECK ("quantityProduced" > 0),
  CONSTRAINT chk_productionbatches_status CHECK (status IN ('PLANNED', 'COMPLETED', 'CANCELLED'))
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productionbatches_product_date ON productionBatches ("productId", "producedAt")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productionbatches_status       ON productionBatches (status, "producedAt")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productionbatches_recipe       ON productionBatches ("recipeId")$q$);

SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS productionBatchComponents (
  "batchComponentId"    INTEGER          GENERATED BY DEFAULT AS IDENTITY,
  "batchId"             INTEGER          NOT NULL,
  "componentProductId"  INTEGER          NOT NULL,
  "quantityConsumed"    DOUBLE PRECISION NOT NULL,
  "unitCode"            VARCHAR(16)      NOT NULL,
  "createdAt"           TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_productionbatchcomponents PRIMARY KEY ("batchComponentId"),
  CONSTRAINT uq_productionbatchcomponents_batch_component UNIQUE ("batchId", "componentProductId"),
  CONSTRAINT chk_productionbatchcomponents_qty CHECK ("quantityConsumed" >= 0)
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productionbatchcomponents_component ON productionBatchComponents ("componentProductId")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_productionbatchcomponents_unit      ON productionBatchComponents ("unitCode")$q$);

-- ---------------------------------------------------------------------------
-- Observability: append-only event log (NO foreign keys)
-- ---------------------------------------------------------------------------
SELECT fn_mig_try($q$
CREATE TABLE IF NOT EXISTS inventoryEventLog (
  "eventId"         INTEGER          GENERATED BY DEFAULT AS IDENTITY,
  "eventType"       VARCHAR(40)      NOT NULL,
  "entityType"      VARCHAR(40)      NOT NULL,
  "productId"       INTEGER          NULL,
  "batchId"         INTEGER          NULL,
  "recipeId"        INTEGER          NULL,
  "quantityBefore"  DOUBLE PRECISION NULL,
  "quantityAfter"   DOUBLE PRECISION NULL,
  "quantityDelta"   DOUBLE PRECISION NULL,
  "unitCode"        VARCHAR(16)      NULL,
  source            VARCHAR(60)      NOT NULL DEFAULT 'DB_TRIGGER',
  detail            VARCHAR(500)     NULL,
  "createdAt"       TIMESTAMP        NOT NULL DEFAULT now(),
  CONSTRAINT pk_inventoryeventlog PRIMARY KEY ("eventId")
)$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_inventoryeventlog_product ON inventoryEventLog ("productId", "createdAt")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_inventoryeventlog_type    ON inventoryEventLog ("eventType", "createdAt")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_inventoryeventlog_batch   ON inventoryEventLog ("batchId")$q$);
SELECT fn_mig_try($q$CREATE INDEX IF NOT EXISTS ix_inventoryeventlog_created ON inventoryEventLog ("createdAt")$q$);

-- ---------------------------------------------------------------------------
-- Foreign keys (added individually; each is skipped + logged if it cannot be added)
-- ---------------------------------------------------------------------------
SELECT fn_mig_fk('productinventoryprofile', 'fk_productinventoryprofile_product', 'FOREIGN KEY ("productId") REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT fn_mig_fk('productinventoryprofile', 'fk_productinventoryprofile_class',   'FOREIGN KEY ("classificationId") REFERENCES productClassifications ("classificationId") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT fn_mig_fk('productinventoryprofile', 'fk_productinventoryprofile_unit',    'FOREIGN KEY ("stockUnitCode") REFERENCES unitsOfMeasure ("unitCode") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT fn_mig_fk('componentstock',          'fk_componentstock_product',          'FOREIGN KEY ("productId") REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT fn_mig_fk('recipes',                 'fk_recipes_product',                 'FOREIGN KEY ("productId") REFERENCES productList ("productId") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT fn_mig_fk('recipecomponents',        'fk_recipecomponents_recipe',         'FOREIGN KEY ("recipeId") REFERENCES recipes ("recipeId") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT fn_mig_fk('recipecomponents',        'fk_recipecomponents_component',      'FOREIGN KEY ("componentProductId") REFERENCES productList ("productId") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT fn_mig_fk('recipecomponents',        'fk_recipecomponents_unit',           'FOREIGN KEY ("unitCode") REFERENCES unitsOfMeasure ("unitCode") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT fn_mig_fk('productionbatches',       'fk_productionbatches_product',       'FOREIGN KEY ("productId") REFERENCES productList ("productId") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT fn_mig_fk('productionbatches',       'fk_productionbatches_recipe',        'FOREIGN KEY ("recipeId") REFERENCES recipes ("recipeId") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT fn_mig_fk('productionbatchcomponents','fk_productionbatchcomponents_batch',     'FOREIGN KEY ("batchId") REFERENCES productionBatches ("batchId") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT fn_mig_fk('productionbatchcomponents','fk_productionbatchcomponents_component', 'FOREIGN KEY ("componentProductId") REFERENCES productList ("productId") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT fn_mig_fk('productionbatchcomponents','fk_productionbatchcomponents_unit',      'FOREIGN KEY ("unitCode") REFERENCES unitsOfMeasure ("unitCode") ON DELETE RESTRICT ON UPDATE CASCADE');

-- ---------------------------------------------------------------------------
-- Trigger functions + triggers (log inserts/updates only)
-- ---------------------------------------------------------------------------
SELECT fn_mig_try($q$
CREATE OR REPLACE FUNCTION fn_003_log_component_stock() RETURNS trigger AS $fn$
DECLARE
  v_source VARCHAR(60) := COALESCE(NULLIF(current_setting('app.event_source', true), ''), 'DB_TRIGGER');
  v_unit   VARCHAR(16);
BEGIN
  SELECT "stockUnitCode" INTO v_unit FROM productInventoryProfile WHERE "productId" = NEW."productId";
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inventoryEventLog ("eventType", "entityType", "productId", "quantityBefore", "quantityAfter", "quantityDelta", "unitCode", source)
    VALUES ('COMPONENT_STOCK_CREATED', 'componentStock', NEW."productId", NULL, NEW."quantityOnHand", NEW."quantityOnHand", v_unit, v_source);
  ELSIF NEW."quantityOnHand" IS DISTINCT FROM OLD."quantityOnHand" THEN
    INSERT INTO inventoryEventLog ("eventType", "entityType", "productId", "quantityBefore", "quantityAfter", "quantityDelta", "unitCode", source)
    VALUES ('COMPONENT_STOCK_CHANGED', 'componentStock', NEW."productId", OLD."quantityOnHand", NEW."quantityOnHand",
            NEW."quantityOnHand" - OLD."quantityOnHand", v_unit, v_source);
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql$q$);

SELECT fn_mig_try($q$
CREATE OR REPLACE FUNCTION fn_003_log_production_batch() RETURNS trigger AS $fn$
DECLARE
  v_source VARCHAR(60) := COALESCE(NULLIF(current_setting('app.event_source', true), ''), 'DB_TRIGGER');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inventoryEventLog ("eventType", "entityType", "productId", "batchId", "recipeId", "quantityAfter", "quantityDelta", source, detail)
    VALUES ('PRODUCTION_BATCH_RECORDED', 'productionBatches', NEW."productId", NEW."batchId", NEW."recipeId",
            NEW."quantityProduced", NEW."quantityProduced", v_source, 'status=' || NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO inventoryEventLog ("eventType", "entityType", "productId", "batchId", "recipeId", "quantityAfter", source, detail)
    VALUES ('PRODUCTION_BATCH_STATUS_CHANGED', 'productionBatches', NEW."productId", NEW."batchId", NEW."recipeId",
            NEW."quantityProduced", v_source, OLD.status || ' -> ' || NEW.status);
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql$q$);

SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_unitsofmeasure_touch ON unitsOfMeasure;
CREATE TRIGGER trg_unitsofmeasure_touch BEFORE UPDATE ON unitsOfMeasure FOR EACH ROW EXECUTE FUNCTION fn_003_touch_updated_at()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_productclassifications_touch ON productClassifications;
CREATE TRIGGER trg_productclassifications_touch BEFORE UPDATE ON productClassifications FOR EACH ROW EXECUTE FUNCTION fn_003_touch_updated_at()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_productinventoryprofile_touch ON productInventoryProfile;
CREATE TRIGGER trg_productinventoryprofile_touch BEFORE UPDATE ON productInventoryProfile FOR EACH ROW EXECUTE FUNCTION fn_003_touch_updated_at()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_componentstock_touch ON componentStock;
CREATE TRIGGER trg_componentstock_touch BEFORE UPDATE ON componentStock FOR EACH ROW EXECUTE FUNCTION fn_003_touch_updated_at()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_recipes_touch ON recipes;
CREATE TRIGGER trg_recipes_touch BEFORE UPDATE ON recipes FOR EACH ROW EXECUTE FUNCTION fn_003_touch_updated_at()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_recipecomponents_touch ON recipeComponents;
CREATE TRIGGER trg_recipecomponents_touch BEFORE UPDATE ON recipeComponents FOR EACH ROW EXECUTE FUNCTION fn_003_touch_updated_at()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_productionbatches_touch ON productionBatches;
CREATE TRIGGER trg_productionbatches_touch BEFORE UPDATE ON productionBatches FOR EACH ROW EXECUTE FUNCTION fn_003_touch_updated_at()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_componentstock_log ON componentStock;
CREATE TRIGGER trg_componentstock_log AFTER INSERT OR UPDATE ON componentStock FOR EACH ROW EXECUTE FUNCTION fn_003_log_component_stock()$q$);
SELECT fn_mig_try($q$DROP TRIGGER IF EXISTS trg_productionbatches_log ON productionBatches;
CREATE TRIGGER trg_productionbatches_log AFTER INSERT OR UPDATE ON productionBatches FOR EACH ROW EXECUTE FUNCTION fn_003_log_production_batch()$q$);

-- ---------------------------------------------------------------------------
-- Views (read-only)
-- ---------------------------------------------------------------------------
SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_default_low_stock_threshold AS
SELECT COALESCE(
  (SELECT CASE WHEN btrim(s."settingValue") ~ '^[0-9]+(\.[0-9]+)?$' THEN btrim(s."settingValue")::double precision END
   FROM app_settings s WHERE s."settingKey" = 'low_stock_threshold' LIMIT 1),
  5::double precision) AS "thresholdValue"$q$, 'v_default_low_stock_threshold');

SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_recipe_requirements AS
SELECT
  r."recipeId", r."productId", fp."productName", fp."productFlavor",
  pp."productSize" AS "productSize",
  CASE pp."productSize" WHEN 10 THEN 'Ten' WHEN 100 THEN 'Hundred' WHEN 1000 THEN 'Thousand' ELSE NULL END AS "sizeLabel",
  r."recipeName", r."isActive", r."yieldQuantity",
  rc."recipeComponentId", rc."componentProductId",
  cp."productName" AS "componentName", cp."productFlavor" AS "componentFlavor",
  rc."quantityRequired", rc."unitCode"
FROM recipes r
JOIN productList fp ON fp."productId" = r."productId"
LEFT JOIN productPricing pp ON pp."productId" = r."productId"
LEFT JOIN recipeComponents rc ON rc."recipeId" = r."recipeId"
LEFT JOIN productList cp ON cp."productId" = rc."componentProductId"$q$, 'v_recipe_requirements');

SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_component_stock_status AS
SELECT
  l."productId", l."productName", l."productFlavor",
  pc."classificationCode", pip."stockUnitCode" AS "unitCode",
  COALESCE(cs."quantityOnHand", 0) AS "quantityOnHand",
  (cs."productId" IS NULL) AS "missingStockRow",
  COALESCE(pip."lowStockThreshold", pc."lowStockThreshold", d."thresholdValue") AS "lowStockThreshold",
  (COALESCE(cs."quantityOnHand", 0) <= 0) AS "isOutOfStock",
  (COALESCE(cs."quantityOnHand", 0) <= COALESCE(pip."lowStockThreshold", pc."lowStockThreshold", d."thresholdValue")) AS "isLowStock"
FROM productInventoryProfile pip
JOIN productClassifications pc ON pc."classificationId" = pip."classificationId" AND pc."productKind" = 'COMPONENT'
JOIN productList l ON l."productId" = pip."productId"
LEFT JOIN componentStock cs ON cs."productId" = pip."productId"
CROSS JOIN v_default_low_stock_threshold d$q$, 'v_component_stock_status');

SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_inventory_status AS
SELECT
  'FINISHED'::text AS "inventoryKind", l."productId", l."productName", l."productFlavor",
  COALESCE(pip."stockUnitCode", 'EA')::varchar AS "unitCode",
  a."itemsRemaining"::double precision AS "quantityOnHand",
  COALESCE(pip."lowStockThreshold", pc."lowStockThreshold", d."thresholdValue") AS "lowStockThreshold",
  (a."itemsRemaining" <= 0) AS "isOutOfStock",
  (a."itemsRemaining" <= COALESCE(pip."lowStockThreshold", pc."lowStockThreshold", d."thresholdValue")) AS "isLowStock",
  (CASE WHEN a."itemsRemaining" <= 0 THEN 'OUT_OF_STOCK'
        WHEN a."itemsRemaining" <= COALESCE(pip."lowStockThreshold", pc."lowStockThreshold", d."thresholdValue") THEN 'LOW'
        ELSE 'OK' END)::text AS "stockState"
FROM productList l
JOIN availableItems a ON a."productId" = l."productId"
LEFT JOIN productInventoryProfile pip ON pip."productId" = l."productId"
LEFT JOIN productClassifications pc ON pc."classificationId" = pip."classificationId"
CROSS JOIN v_default_low_stock_threshold d
WHERE COALESCE(pc."productKind", 'FINISHED') = 'FINISHED'
UNION ALL
SELECT
  'COMPONENT'::text, c."productId", c."productName", c."productFlavor", c."unitCode"::varchar,
  c."quantityOnHand", c."lowStockThreshold", c."isOutOfStock", c."isLowStock",
  (CASE WHEN c."isOutOfStock" THEN 'OUT_OF_STOCK' WHEN c."isLowStock" THEN 'LOW' ELSE 'OK' END)::text
FROM v_component_stock_status c$q$, 'v_inventory_status');

SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_recipe_component_capacity AS
SELECT
  x.*,
  ROW_NUMBER() OVER (PARTITION BY x."recipeId" ORDER BY x."capacityItems" ASC, x."recipeComponentId" ASC) AS "limitRank"
FROM (
  SELECT
    r."recipeId", r."productId", rc."recipeComponentId", rc."componentProductId",
    cp."productName" AS "componentName", rc."unitCode" AS "recipeUnitCode", pip."stockUnitCode" AS "stockUnitCode",
    rc."quantityRequired" AS "quantityRequired", r."yieldQuantity" AS "yieldQuantity",
    COALESCE(cs."quantityOnHand", 0) AS "quantityOnHand",
    CASE WHEN pip."productId" IS NULL THEN 'NO_INVENTORY_PROFILE'
         WHEN ru."unitType" <> su."unitType" THEN 'UNIT_MISMATCH'
         WHEN cs."productId" IS NULL THEN 'NO_STOCK_RECORD'
         ELSE 'OK' END AS "lineStatus",
    (CASE WHEN pip."productId" IS NULL OR ru."unitType" <> su."unitType" THEN 0
          ELSE floor(round((COALESCE(cs."quantityOnHand", 0) * su."factorToBase" * r."yieldQuantity"
                            / (rc."quantityRequired" * ru."factorToBase"))::numeric, 6)) END)::double precision AS "capacityItems"
  FROM recipes r
  JOIN recipeComponents rc ON rc."recipeId" = r."recipeId"
  JOIN productList cp ON cp."productId" = rc."componentProductId"
  JOIN unitsOfMeasure ru ON ru."unitCode" = rc."unitCode"
  LEFT JOIN productInventoryProfile pip ON pip."productId" = rc."componentProductId"
  LEFT JOIN unitsOfMeasure su ON su."unitCode" = pip."stockUnitCode"
  LEFT JOIN componentStock cs ON cs."productId" = rc."componentProductId"
  WHERE r."isActive"
) x$q$, 'v_recipe_component_capacity');

SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_production_capacity AS
SELECT
  r."productId", fp."productName", fp."productFlavor", r."recipeId", r."recipeName",
  r."yieldQuantity" AS "yieldQuantity",
  (SELECT count(*) FROM recipeComponents n WHERE n."recipeId" = r."recipeId")::double precision AS "componentCount",
  COALESCE(lim."capacityItems", 0) AS "maxProducible",
  lim."componentProductId" AS "limitingComponentId",
  lim."componentName"      AS "limitingComponentName",
  lim."stockUnitCode"      AS "limitingUnitCode",
  lim."quantityOnHand"     AS "limitingQuantityOnHand",
  CASE WHEN lim."recipeId" IS NULL THEN 'NO_COMPONENTS' ELSE lim."lineStatus" END AS "capacityStatus",
  COALESCE(a."itemsRemaining", 0)::double precision AS "finishedStock",
  (COALESCE(a."itemsRemaining", 0) + COALESCE(lim."capacityItems", 0))::double precision AS "totalAvailable",
  (COALESCE(a."itemsRemaining", 0) <= 0) AS "finishedOutOfStock",
  (COALESCE(lim."capacityItems", 0) > 0) AS "canProduce"
FROM recipes r
JOIN productList fp ON fp."productId" = r."productId"
LEFT JOIN v_recipe_component_capacity lim ON lim."recipeId" = r."recipeId" AND lim."limitRank" = 1
LEFT JOIN availableItems a ON a."productId" = r."productId"
WHERE r."isActive"$q$, 'v_production_capacity');

SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_recipe_issues AS
SELECT 'FINISHED_WITHOUT_ACTIVE_RECIPE'::text AS "issueType", NULL::integer AS "recipeId",
       l."productId", l."productName",
       NULL::integer AS "componentProductId", NULL::varchar AS "componentName",
       'Finished product has no active recipe'::text AS "detail"
FROM productInventoryProfile pip
JOIN productClassifications pc ON pc."classificationId" = pip."classificationId" AND pc."productKind" = 'FINISHED'
JOIN productList l ON l."productId" = pip."productId"
WHERE NOT EXISTS (SELECT 1 FROM recipes r WHERE r."productId" = pip."productId" AND r."isActive")
UNION ALL
SELECT 'RECIPE_WITHOUT_COMPONENTS', r."recipeId", r."productId", l."productName", NULL, NULL,
       'Active recipe has no component lines'
FROM recipes r
JOIN productList l ON l."productId" = r."productId"
WHERE r."isActive" AND NOT EXISTS (SELECT 1 FROM recipeComponents rc WHERE rc."recipeId" = r."recipeId")
UNION ALL
SELECT 'SELF_REFERENCE', r."recipeId", r."productId", l."productName", rc."componentProductId", l."productName",
       'A product is listed as a component of itself'
FROM recipes r
JOIN recipeComponents rc ON rc."recipeId" = r."recipeId" AND rc."componentProductId" = r."productId"
JOIN productList l ON l."productId" = r."productId"
UNION ALL
SELECT 'COMPONENT_NOT_CLASSIFIED', r."recipeId", r."productId", fp."productName", rc."componentProductId", cp."productName",
       'Component has no productInventoryProfile (no stock unit / classification)'
FROM recipes r
JOIN recipeComponents rc ON rc."recipeId" = r."recipeId"
JOIN productList fp ON fp."productId" = r."productId"
JOIN productList cp ON cp."productId" = rc."componentProductId"
LEFT JOIN productInventoryProfile pip ON pip."productId" = rc."componentProductId"
WHERE r."isActive" AND pip."productId" IS NULL
UNION ALL
SELECT 'COMPONENT_KIND_MISMATCH', r."recipeId", r."productId", fp."productName", rc."componentProductId", cp."productName",
       'Component is classified ' || pc."classificationCode" || ', not a COMPONENT class'
FROM recipes r
JOIN recipeComponents rc ON rc."recipeId" = r."recipeId"
JOIN productList fp ON fp."productId" = r."productId"
JOIN productList cp ON cp."productId" = rc."componentProductId"
JOIN productInventoryProfile pip ON pip."productId" = rc."componentProductId"
JOIN productClassifications pc ON pc."classificationId" = pip."classificationId" AND pc."productKind" <> 'COMPONENT'
WHERE r."isActive"
UNION ALL
SELECT 'UNIT_MISMATCH', c."recipeId", c."productId", fp."productName", c."componentProductId", c."componentName",
       'Recipe unit ' || c."recipeUnitCode" || ' cannot be converted to stock unit ' || c."stockUnitCode"
FROM v_recipe_component_capacity c
JOIN productList fp ON fp."productId" = c."productId"
WHERE c."lineStatus" = 'UNIT_MISMATCH'
UNION ALL
SELECT 'NO_STOCK_RECORD', c."recipeId", c."productId", fp."productName", c."componentProductId", c."componentName",
       'Component has no componentStock row (treated as 0 on hand)'
FROM v_recipe_component_capacity c
JOIN productList fp ON fp."productId" = c."productId"
WHERE c."lineStatus" = 'NO_STOCK_RECORD'$q$, 'v_recipe_issues');

SELECT fn_mig_try($q$
CREATE OR REPLACE VIEW v_inventory_event_daily AS
SELECT
  ("createdAt")::date AS "eventDate", "eventType",
  count(*)::double precision AS "eventCount",
  round(sum("quantityDelta")::numeric, 4)::double precision AS "quantityDeltaTotal"
FROM inventoryEventLog
GROUP BY ("createdAt")::date, "eventType"$q$, 'v_inventory_event_daily');

-- ============================================================================
-- READ-ONLY CHECKS (commented out)
-- ============================================================================
-- SELECT * FROM schema_migration_skips ORDER BY id DESC;
-- SELECT * FROM v_recipe_issues ORDER BY "issueType", "productName";
-- SELECT * FROM v_inventory_status WHERE "stockState" <> 'OK';
-- SELECT "productName", "maxProducible", "capacityStatus", "limitingComponentName" FROM v_production_capacity;
-- SELECT * FROM inventoryEventLog ORDER BY "eventId" DESC LIMIT 50;