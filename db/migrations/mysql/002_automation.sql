-- ============================================================================
-- MySQL 002_automation.sql  - triggers + procedure that populate values automatically.
--
-- Rules (never destructive):
--   * Values the API supplies are ALWAYS kept. A trigger only fills a value the API left as
--     0 / blank, using the app's own formulas:
--       costPerItem       = productList.productPrice / productQuantity
--       sellingPrice      = costPerItem x (1 + markup_rate)                (default 30%)
--       productProfit     = productQuantity x sellingPrice
--       productCommission = productProfit - costPerItem x productQuantity
--   * Blank names / descriptions / image_url are filled from productList.
--   * Every sodEodItems insert/update upserts the day's row in daily_financials:
--       sold             = itemsTaken - itemsRemaining
--       revenue          = sold x sellingPrice          cost = sold x costPerItem
--       profit           = sold x (sellingPrice - costPerItem)           (as product.service)
--       commissionAmount = (1 - shop_commission_rate) x profit           (groupedCommission)
--       shopShare        = shop_commission_rate x profit
--
-- Needs the TRIGGER and CREATE ROUTINE privileges. If binary logging is on and the user is not
-- SUPER, the server may answer error 1419: an admin then runs
--   SET GLOBAL log_bin_trust_function_creators = 1;
-- ============================================================================

DELIMITER //

DROP TRIGGER IF EXISTS trg_productList_bi//
CREATE TRIGGER trg_productList_bi BEFORE INSERT ON productList FOR EACH ROW
BEGIN
  IF NEW.image_url IS NULL OR TRIM(NEW.image_url) = '' THEN
    SET NEW.image_url = CONCAT(TRIM(NEW.productName), ' ', TRIM(NEW.productFlavor), '.webp');
  END IF;
END//

DROP TRIGGER IF EXISTS trg_productList_bu//
CREATE TRIGGER trg_productList_bu BEFORE UPDATE ON productList FOR EACH ROW
BEGIN
  IF NEW.image_url IS NULL OR TRIM(NEW.image_url) = '' THEN
    SET NEW.image_url = CONCAT(TRIM(NEW.productName), ' ', TRIM(NEW.productFlavor), '.webp');
  END IF;
END//

DROP TRIGGER IF EXISTS trg_productPricing_bi//
CREATE TRIGGER trg_productPricing_bi BEFORE INSERT ON productPricing FOR EACH ROW
BEGIN
  DECLARE v_price  DOUBLE;
  DECLARE v_markup DOUBLE;
  SELECT productPrice INTO v_price FROM productList WHERE productId = NEW.productId;
  SELECT CAST(settingValue AS DECIMAL(12,6)) INTO v_markup FROM app_settings WHERE settingKey = 'markup_rate';
  SET v_markup = IFNULL(v_markup, 0.30);
  IF IFNULL(NEW.costPerItem, 0) = 0 AND IFNULL(NEW.productQuantity, 0) > 0 AND v_price IS NOT NULL THEN
    SET NEW.costPerItem = v_price / NEW.productQuantity;
  END IF;
  IF IFNULL(NEW.sellingPrice, 0) = 0 THEN
    SET NEW.sellingPrice = NEW.costPerItem * (1 + v_markup);
  END IF;
  IF IFNULL(NEW.productProfit, 0) = 0 THEN
    SET NEW.productProfit = NEW.productQuantity * NEW.sellingPrice;
  END IF;
  IF IFNULL(NEW.productCommission, 0) = 0 THEN
    SET NEW.productCommission = NEW.productProfit - NEW.costPerItem * NEW.productQuantity;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_productPricing_bu//
CREATE TRIGGER trg_productPricing_bu BEFORE UPDATE ON productPricing FOR EACH ROW
BEGIN
  DECLARE v_price  DOUBLE;
  DECLARE v_markup DOUBLE;
  SELECT productPrice INTO v_price FROM productList WHERE productId = NEW.productId;
  SELECT CAST(settingValue AS DECIMAL(12,6)) INTO v_markup FROM app_settings WHERE settingKey = 'markup_rate';
  SET v_markup = IFNULL(v_markup, 0.30);
  IF IFNULL(NEW.costPerItem, 0) = 0 AND IFNULL(NEW.productQuantity, 0) > 0 AND v_price IS NOT NULL THEN
    SET NEW.costPerItem = v_price / NEW.productQuantity;
  END IF;
  IF IFNULL(NEW.sellingPrice, 0) = 0 THEN
    SET NEW.sellingPrice = NEW.costPerItem * (1 + v_markup);
  END IF;
  IF IFNULL(NEW.productProfit, 0) = 0 THEN
    SET NEW.productProfit = NEW.productQuantity * NEW.sellingPrice;
  END IF;
  IF IFNULL(NEW.productCommission, 0) = 0 THEN
    SET NEW.productCommission = NEW.productProfit - NEW.costPerItem * NEW.productQuantity;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_sodEodItems_bi//
CREATE TRIGGER trg_sodEodItems_bi BEFORE INSERT ON sodEodItems FOR EACH ROW
BEGIN
  IF NEW.productName IS NULL OR TRIM(NEW.productName) = '' THEN
    SET NEW.productName = IFNULL((SELECT productName FROM productList WHERE productId = NEW.productId), '');
  END IF;
END//

DROP TRIGGER IF EXISTS trg_productItemPricing_bi//
CREATE TRIGGER trg_productItemPricing_bi BEFORE INSERT ON productItemPricing FOR EACH ROW
BEGIN
  IF NEW.productDescription IS NULL OR TRIM(NEW.productDescription) = '' THEN
    SET NEW.productDescription = IFNULL((SELECT productName FROM productList WHERE productId = NEW.productId), '');
  END IF;
END//

DROP TRIGGER IF EXISTS trg_cartList_bi//
CREATE TRIGGER trg_cartList_bi BEFORE INSERT ON cartList FOR EACH ROW
BEGIN
  IF NEW.productName IS NULL OR TRIM(NEW.productName) = '' THEN
    SET NEW.productName = IFNULL((SELECT productName FROM productList WHERE productId = NEW.productId), '');
  END IF;
  IF NEW.productFlavor IS NULL OR TRIM(NEW.productFlavor) = '' THEN
    SET NEW.productFlavor = IFNULL((SELECT productFlavor FROM productList WHERE productId = NEW.productId), '');
  END IF;
END//

DROP TRIGGER IF EXISTS trg_stockItems_bi//
CREATE TRIGGER trg_stockItems_bi BEFORE INSERT ON stockItems FOR EACH ROW
BEGIN
  IF NEW.productName IS NULL OR TRIM(NEW.productName) = '' THEN
    SET NEW.productName = IFNULL((SELECT productName FROM productList WHERE productId = NEW.productId), '');
  END IF;
  IF NEW.productFlavor IS NULL OR TRIM(NEW.productFlavor) = '' THEN
    SET NEW.productFlavor = IFNULL((SELECT productFlavor FROM productList WHERE productId = NEW.productId), '');
  END IF;
END//

DROP PROCEDURE IF EXISTS sp_upsert_daily_financial//
CREATE PROCEDURE sp_upsert_daily_financial(
  IN p_productId INT, IN p_productName VARCHAR(150),
  IN p_taken INT, IN p_remaining INT, IN p_when DATETIME)
BEGIN
  DECLARE v_selling DOUBLE DEFAULT 0;
  DECLARE v_cost    DOUBLE DEFAULT 0;
  DECLARE v_rate    DOUBLE;
  DECLARE v_sold    INT;
  DECLARE v_profit  DOUBLE;
  SELECT sellingPrice, costPerItem INTO v_selling, v_cost FROM productPricing WHERE productId = p_productId;
  SELECT CAST(settingValue AS DECIMAL(12,6)) INTO v_rate FROM app_settings WHERE settingKey = 'shop_commission_rate';
  SET v_rate    = IFNULL(v_rate, 0.30);
  SET v_selling = IFNULL(v_selling, 0);
  SET v_cost    = IFNULL(v_cost, 0);
  SET v_sold    = GREATEST(IFNULL(p_taken, 0) - IFNULL(p_remaining, 0), 0);
  SET v_profit  = v_sold * (v_selling - v_cost);
  INSERT INTO daily_financials
    (businessDate, productId, productName, itemsTaken, itemsRemaining, itemsSold,
     sellingPrice, costPerItem, revenue, cost, profit, commissionAmount, shopShare)
  VALUES
    (DATE(IFNULL(p_when, NOW())), p_productId, IFNULL(p_productName, ''), IFNULL(p_taken, 0), IFNULL(p_remaining, 0), v_sold,
     v_selling, v_cost, ROUND(v_sold * v_selling, 4), ROUND(v_sold * v_cost, 4), ROUND(v_profit, 4),
     ROUND((1 - v_rate) * v_profit, 4), ROUND(v_rate * v_profit, 4))
  ON DUPLICATE KEY UPDATE
    productName = VALUES(productName), itemsTaken = VALUES(itemsTaken), itemsRemaining = VALUES(itemsRemaining),
    itemsSold = VALUES(itemsSold), sellingPrice = VALUES(sellingPrice), costPerItem = VALUES(costPerItem),
    revenue = VALUES(revenue), cost = VALUES(cost), profit = VALUES(profit),
    commissionAmount = VALUES(commissionAmount), shopShare = VALUES(shopShare);
END//

DROP TRIGGER IF EXISTS trg_sodEodItems_ai//
CREATE TRIGGER trg_sodEodItems_ai AFTER INSERT ON sodEodItems FOR EACH ROW
BEGIN
  CALL sp_upsert_daily_financial(NEW.productId, NEW.productName, NEW.itemsTaken, NEW.itemsRemaining, NEW.lastUpdated);
END//

DROP TRIGGER IF EXISTS trg_sodEodItems_au//
CREATE TRIGGER trg_sodEodItems_au AFTER UPDATE ON sodEodItems FOR EACH ROW
BEGIN
  CALL sp_upsert_daily_financial(NEW.productId, NEW.productName, NEW.itemsTaken, NEW.itemsRemaining, NEW.lastUpdated);
END//

DELIMITER ;
