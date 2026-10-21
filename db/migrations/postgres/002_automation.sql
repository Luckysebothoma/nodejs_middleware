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
