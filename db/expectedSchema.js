// db/expectedSchema.js
// The columns the API relies on. verifySchema() compares the live database to this, so a database
// that already contained OLD tables (CREATE TABLE IF NOT EXISTS skips those) is reported loudly
// instead of failing later at query time.
export const SHARED_TABLES = {
  app_settings: ['settingKey', 'settingValue', 'description', 'updatedAt'],
  productList: ['productId', 'productName', 'productFlavor', 'productPrice', 'image_url', 'createdAt', 'updatedAt'],
  productPricing: ['productId', 'productSize', 'productQuantity', 'costPerItem', 'sellingPrice', 'productProfit',
    'productCommission', 'itemGrouping', 'unitMargin', 'marginPct', 'packCost', 'createdAt', 'updatedAt'],
  availableItems: ['productId', 'itemsRemaining', 'lastUpdated', 'isOutOfStock'],
  priceTracing: ['productId', 'date', 'accAmount'],
  estimates: ['productId', 'estimatedSelling', 'actualSelling', 'lastUpdated', 'variance', 'sellThroughPct'],
  sodEodItems: ['productId', 'productName', 'itemsTaken', 'itemsRemaining', 'lastUpdated', 'availableItems', 'outOfStock', 'itemsSold'],
  productItemPricing: ['productId', 'productDescription', 'itemGroup', 'itemsRemainder', 'costOfRemainder',
    'groupedQuantity', 'groupedProfit', 'groupedCommission'],
  cartList: ['cartId', 'productId', 'productName', 'productFlavor', 'productPrice', 'addedAt'],
  stockItems: ['productId', 'productName', 'productFlavor', 'productPrice', 'lastUpdated', 'productQuantity'],
  stockedItems: ['stockId', 'productId', 'stockDate', 'stockPrice', 'stockQuantity'],
  daily_financials: ['businessDate', 'productId', 'productName', 'itemsTaken', 'itemsRemaining', 'itemsSold', 'sellingPrice',
    'costPerItem', 'revenue', 'cost', 'profit', 'commissionAmount', 'shopShare', 'recordedAt', 'updatedAt'],
  v_product_financials: ['productId', 'costPerItem', 'sellingPrice', 'expectedCostPerItem', 'expectedSellingPrice', 'differsFromFormula'],
  v_stock_status: ['productId', 'itemsRemaining', 'isLowStock', 'stockValueAtCost', 'stockValueAtSelling'],
  v_daily_summary: ['businessDate', 'products', 'itemsSold', 'revenue', 'cost', 'profit', 'commissionAmount', 'shopShare']
};

export const POSTGRES_ONLY_TABLES = {
  product_images: ['product_id', 'content_type', 'byte_size', 'sha256', 'original_name', 'data', 'created_at', 'updated_at'],
  auth_tokens: ['token_hash', 'user_id', 'issuer', 'audience', 'issued_at', 'expires_at', 'ttl_seconds', 'source',
    'permissions', 'first_seen', 'last_seen', 'created_at', 'updated_at'],
  token_access_logs: ['id', 'token_hash', 'user_id', 'request_path', 'ip_address', 'accessed_at']
};

export const expectedFor = (engine) => engine === 'postgres' ? { ...SHARED_TABLES, ...POSTGRES_ONLY_TABLES } : SHARED_TABLES;
