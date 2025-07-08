import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';

import { getConnection, mysqlPool } from '../config/db.js'
 

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;


const productPricingKey = "productPricing";
const availableItemsKey = "availableItems"
const cartListKey = "cartList"
const estimatesKey = "estimates"
const productInventoryKey = "productInventory"
const productItemPricingKey = "productItemPricing"
const productListKey = "productList"
const sodEodItemsKey = "sodEodItems"
const stockItemsKey = "stockItems"
const stockedItemsKey = "stockedItems"


// uploadHandler.js
import multer from 'multer';
import path from 'path';
import { pgClient } from '../config/postgres.js';

// File storage config
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '_' + file.originalname);
  }
});
export const upload = multer({ storage });

// Reusable function
export async function handleFileUpload(req, res) {
  try {
    const productId = req.body.product_id;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded.' });
    }

    const client = await pgClient.connect();

    for (let file of files) {
      const imageUrl = `/uploads/${file.filename}`;

      // Assume there's a column 'image_url' and a table 'products'
      await client.query(
        'UPDATE products SET image_url = $1 WHERE id = $2',
        [imageUrl, productId]
      );
    }

    client.release();

    res.status(200).json({ message: 'Upload successful.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed.' });
  }
}




/*
const updateProducts_Batch = async (req, res) => {
  const { productList, pricingList, availableItems, priceTracingList } = req.body;
  const connection = await getConnection();

  // Pretty log the full incoming body
  console.log("🟢 updateProducts_Batch called with body:\n", JSON.stringify(req.body, null, 2));

  // Validate presence of root-level fields
  const missingFields = [];
  if (!productList) missingFields.push("productList");
  if (!pricingList) missingFields.push("pricingList");
  if (!availableItems) missingFields.push("availableItems");
  if (!priceTracingList) missingFields.push("priceTracingList");

  if (missingFields.length > 0) {
    console.error("❌ Missing required root fields:", missingFields);
    return res.status(400).json({ error: `Missing required fields: ${missingFields.join(", ")}` });
  }

  // Validate content of each array
  const invalidEntries = [];

  productList.forEach((p, i) => {
    if (!p.productId || !p.productName || !p.productPrice) {
      invalidEntries.push({ type: "productList", index: i, entry: p });
    }
  });

  pricingList.forEach((p, i) => {
    if (!p.productId || p.sellingPrice == null || p.productSize == null) {
      invalidEntries.push({ type: "pricingList", index: i, entry: p });
    }
  });

  availableItems.forEach((item, i) => {
    if (!item.productId || item.itemsRemaining == null) {
      invalidEntries.push({ type: "availableItems", index: i, entry: item });
    }
  });

  priceTracingList.forEach((t, i) => {
    if (!t.productId || !t.date) {
      invalidEntries.push({ type: "priceTracingList", index: i, entry: t });
    }
  });

  if (invalidEntries.length > 0) {
    console.error("❌ Invalid sub-items detected:", JSON.stringify(invalidEntries, null, 2));
    return res.status(400).json({ error: "Invalid entries in input data", invalidEntries });
  }

  try {
    await connection.beginTransaction();

    // ProductList insert
    for (const p of productList) {
      await connection.query(
        `INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (?, ?, ?, ?, ?)`,
        [p.productId, p.productName, p.productFlavor, p.productPrice, p.image_url]
      );
    }

    // ProductPricing insert
    for (const p of pricingList) {
      await connection.query(
        `INSERT INTO productPricing (productId, productSize, productQuantity, costPerItem, productProfit, sellingPrice, productCommission, itemGrouping)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.productId, p.productSize, p.productQuantity, p.costPerItem,
          p.productProfit, p.sellingPrice, p.productCommission, p.itemGrouping
        ]
      );
    }

    // AvailableItems insert
    for (const item of availableItems) {
      await connection.query(
        `INSERT INTO availableItems (productId, itemsRemaining, lastUpdated)
         VALUES (?, ?, ?)`,
        [item.productId, item.itemsRemaining, item.lastUpdated || new Date()]
      );
    }

    // PriceTracing insert
    for (const trace of priceTracingList) {
      await connection.query(
        `INSERT INTO priceTracing (productId, accAmount, date)
         VALUES (?, ?, ?)`,
        [trace.productId, trace.accAmount, trace.date]
      );
    }

    await connection.commit();
    console.log("✅ Batch insert successful.");
return logResponseDetails(req, res, {
      status: 200,
      success: true });
  } catch (error) {
    await connection.rollback();
    console.error("🔥 Batch insert error:", error);
   return logResponseDetails(req, res, {
      status: 500,
     error: "Internal server error", details: error.message });
  } finally {
    await connection.end();
  }
};


*/

/*
const updateProducts_Batch = async(req, res) =>{
  
  const { productList, pricingList, availableItems, priceTracingList } = req.body;

  const connection = await getConnection();

  // add req to logger and valid the passed var and display whats invalid or missing
  console.log("updateProducts_Batch called with body:", req.body);

  const missingFields = [];
  if (!productList) missingFields.push("productList");
  if (!pricingList) missingFields.push("pricingList");
  if (!availableItems) missingFields.push("availableItems");
  if (!priceTracingList) missingFields.push("priceTracingList");

  if (missingFields.length > 0) {
    console.error("Missing required fields:", missingFields);
    return res.status(400).json({ error: `Missing required fields: ${missingFields.join(", ")}` });
  }

  try {
    await connection.beginTransaction();

    // ProductList insert
    for (const p of productList) {
      await connection.query(
        'INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (?, ?, ?, ?, ?)',
        [p.productId, p.productName, p.productFlavor, p.productPrice, p.image_url]
      );
    }

    // ProductPricing insert
    for (const p of pricingList) {
      await connection.query(
        'INSERT INTO productPricing (productId, productSize, productQuantity, costPerItem, productProfit, sellingPrice, productCommission, itemGrouping) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          p.productId, p.productSize, p.productQuantity, p.costPerItem,
          p.productProfit, p.sellingPrice, p.productCommission, p.itemGrouping
        ]
      );
    }

    // AvailableItem insert
    for (const item of availableItems) {
      await connection.query(
        `INSERT INTO availableItems (productId, itemsRemaining, lastUpdated) VALUES (?, ?, ?)`, 
        [item.productId ]
      );
    }

      

    // PriceTracing insert
    for (const trace of priceTracingList) {
      await connection.query(
        'INSERT INTO priceTracing (productId, accAmount, date) VALUES (?, ?, ?)',
        [trace.productId, trace.accAmount, trace.date]
      );
    }

    await connection.commit();
return logResponseDetails(req, res, {
      status: 200,
      success: true });
  } catch (error) {
    await connection.rollback();
    console.error("Batch insert error:", error);
   return logResponseDetails(req, res, {
      status: 500,
     error: error.message });
  } finally {
    await connection.end();
  }
}

*/

/*
const addNewCandy = async(req, res) =>{
    const connection = await getConnection(); // Get a connection from the pool
    await connection.beginTransaction(); // Start the transaction


    try {
        const { product, yummy, availableItem, priceTracing } = req.body;
    
        // Step 1: Add Product
        const [productResult] = await connection.execute(
          'INSERT INTO products (name, description, price) VALUES (?, ?, ?)',
          [product.name, product.description, product.price]
        );
    
        // Step 2: Add Yummy
        const [yummyResult] = await connection.execute(
          'INSERT INTO yummies (name, taste, product_id) VALUES (?, ?, ?)',
          [yummy.name, yummy.taste, productResult.insertId]
        );
    
        // Step 3: Add Available Items
        await connection.execute(
          'INSERT INTO available_items (product_id, quantity) VALUES (?, ?)',
          [productResult.insertId, availableItem.quantity]
        );
    
        // Step 4: Add Price Tracing
        await connection.execute(
          'INSERT INTO price_tracing (product_id, old_price, new_price) VALUES (?, ?, ?)',
          [productResult.insertId, priceTracing.oldPrice, priceTracing.newPrice]
        );
    
        // If all queries are successful, commit the transaction
        await connection.commit();
          logResponseDetails(req, res,  {
        status: 200, success: true, message: 'All records added successfully!' });
    
      } catch (error) {
        // If an error occurs, rollback the transaction
        await connection.rollback();
        console.error('Transaction failed, rolled back:', error);
      return logResponseDetails(req, res, {
      status: 500,
     success: false, message: 'Transaction failed', error });
      } finally {
        connection.release(); // Release the connection back to the pool
      }

    };

*/


const updateProducts_Batch = async (req, res) => {

  logRequestDetails(req, "updateProducts_Batch");

  const { productList, pricingList, availableItems, priceTracingList } = req.body;
  const connection = await getConnection();


  console.log("🟢 updateProducts_Batch called with body:\n", JSON.stringify(req.body, null, 2));

  const missingFields = [];
  if (!productList) missingFields.push("productList");
  if (!pricingList) missingFields.push("pricingList");
  if (!availableItems) missingFields.push("availableItems");
  if (!priceTracingList) missingFields.push("priceTracingList");

  if (missingFields.length > 0) {
    console.error("❌ Missing required root fields:", missingFields);

    return logResponseDetails(req, res, {
      status: 400,
      error: `Missing required fields: ${missingFields.join(", ")}`
    });
  }

  try {
    await connection.beginTransaction();



    await connection.query(
        "INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE productName = VALUES(productName), productFlavor = VALUES(productFlavor), productPrice = VALUES(productPrice), image_url = VALUES(image_url)",
        [productList.productId, productList.productName, productList.productFlavor, productList.productPrice, productList.image_url]
      );


  
    await connection.query(
        "INSERT INTO productPricing (productId, productSize, productQuantity, costPerItem, productProfit, sellingPrice, productCommission, itemGrouping) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE productSize = VALUES(productSize), productQuantity = VALUES(productQuantity), costPerItem = VALUES(costPerItem), productProfit = VALUES(productProfit), sellingPrice = VALUES(sellingPrice), productCommission = VALUES(productCommission), itemGrouping = VALUES(itemGrouping)",
        [
          pricingList.productId, pricingList.productSize, pricingList.productQuantity, pricingList.costPerItem,
          pricingList.productProfit, pricingList.sellingPrice, pricingList.productCommission, pricingList.itemGrouping
        ]
      );

   

    await connection.query(
        "INSERT INTO availableItems (productId, itemsRemaining, lastUpdated) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE itemsRemaining = VALUES(itemsRemaining), lastUpdated = VALUES(lastUpdated)",
        [availableItems.productId, availableItems.itemsRemaining, availableItems.lastUpdated || new Date()]
      );


    await connection.query(
        "INSERT INTO priceTracing (productId, accAmount, date) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE accAmount = VALUES(accAmount), date = VALUES(date)",
        [priceTracingList.productId, priceTracingList.accAmount, priceTracingList.date]
      );



      
    await connection.commit();
    console.log("✅ Batch upsert completed.");
return logResponseDetails(req, res, {
      status: 200,
      success: true });

    
  } catch (error) {
    await connection.rollback();
    console.error("🔥 Batch upsert error:", error);
   return logResponseDetails(req, res, {
      status: 500,
     error: "Internal server error", details: error.message });

  } finally {
    await connection.end();
  }
};



const addNewCandy_with_image = async(req,res) => {


      logRequestDetails(req, "addNewCandy_with_image");
    console.log(req,"addNewCandy_with_image Started");

    // JSON fields sent as string, so parse them
const {
  addProductListRequest,
  addProductPricingRequest,
  addAvailableItemsRequest,
  addPriceTracing
} = req.body;

const file = req.file; // multer adds the file here

console.log(`Image: ${JSON.stringify(file)}
  ProductLIst ${JSON.stringify(addProductListRequest)}
 Pprincing ${JSON.stringify(addProductPricingRequest)}
  A Items ${JSON.stringify(addAvailableItemsRequest)}
  Add Price Tracimg ${JSON.stringify(addPriceTracing)}
  `)
    

  
   //logRequestDetails(req, "addNewCandy_with_image");

  //console.log("addNewCandy_with_image Started")
//  const { addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing, file } = req.body;

  // You can now use these variables as needed
  // Example: pass them to your function
  addNewCandy_function(addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing);
  console.log("DOne Adding product, Now adding image")

  //Create mysql insert statement
  // Example: Insert uploaded image metadata into a table called 'product_images'
  // Assuming 'file' contains: { filename, mimetype, size }
const imageInsertQuery = `
  INSERT INTO images (filename, mimetype, size, created_at)
  VALUES ($1, $2, $3, NOW())
  ON CONFLICT (filename) DO UPDATE SET
    mimetype = EXCLUDED.mimetype,
    size = EXCLUDED.size,
    created_at = NOW()
`;

const imageReplacements = [
  file.filename,
  file.mimetype,
  file.size
];


  const responses = await addCachedAndQuery("images", imageInsertQuery,imageReplacements);
console.log("Response after adding products ", responses)

  //await mysqlPool.query(imageInsertQuery, imageReplacements);
 
}
const addNewCandy = async(req, res) =>{

   logRequestDetails(req, "addNewCandy");

  const { addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing } = req.body;
    
  const connection = await getConnection(); // Get a connection from the pool

// Process each part as needed
res.json({ message: 'Data received successfully' });

 await connection.beginTransaction(); // Start the transaction

// Example of logging each part
console.log("" + ' \n Add Product Request:', addProductListRequest);

console.log("" + '\n Add Yummy Request:', addProductPricingRequest);

console.log("" + '\n Add Available Items:', addAvailableItemsRequest);

console.log("" + '\n Add Price Tracing:', addPriceTracing);

try {
const productResult = await addProductRecord(addProductListRequest, connection);
const yummyResult = await addYummyRecord(addProductPricingRequest, connection);
const available_itemsResult = await addAvailableItems(addAvailableItemsRequest, connection)
const price_tracing_Result = await addPriceTrace(addPriceTracing, connection);

// Example of logging each part
console.log(productResult + ' \n Add Product Request:', addProductListRequest);

console.log(yummyResult + '\n Add Yummy Request:', addProductPricingRequest);

console.log(available_itemsResult + '\n Add Available Items:', addAvailableItemsRequest);

console.log(price_tracing_Result + '\n Add Price Tracing:', addPriceTracing);

connection.commit(); // Lats Operation to commit to database
  

} catch (error) {
  await connection.rollback(); // Always await rollback
  const errorMessage = `${getLongTime()}: 🔥 Rollback Operation: ${error}`;
  
  console.error(errorMessage);

  if (!res.headersSent) {
   return logResponseDetails(req, res, {
      status: 500,
     success: false, message: errorMessage });
  }

} finally {
  connection.release();

  // ✅ Only send success if no headers have been sent (not in error)
  if (!res.headersSent) {
    return   logResponseDetails(req, res,  {
        status: 200,
      success: true,
      message: `${getLongTime()}: Operation completed successfully`,
    });
  }
}



}

export const deleteAllProductData = async (productId, redisClient) => {
  const dataTargets = [
    { key: "productPricing", table: "productPricing" },
    { key: "availableItems", table: "availableItems" },
    { key: "cartList", table: "cartList" },
    { key: "estimates", table: "estimates" },
    { key: "productInventory", table: "productInventory" },
    { key: "productItemPricing", table: "productItemPricing" },
    { key: "productList", table: "productList" },
    { key: "sodEodItems", table: "sodEodItems" },
    { key: "stockItems", table: "stockItems" }
  ];

  for (const { key, table } of dataTargets) {
    await deleteRedisAndMySQL(productId, redisClient, key, table);
  }
};
export const deleteRedisAndMySQL = async (productId, redisClient, redisKey, mysqlTable) => {
  const query = `DELETE FROM \`${mysqlTable}\` WHERE productId = ?`;
  const values = [productId];

  let conn;

  try {
    conn = await mysqlPool.getConnection();
    const [mysqlResult] = await conn.query(query, values);

    if (mysqlResult.affectedRows > 0) {
      const redisDelResult = await redisClient.del(redisKey);
      console.log(`🗑️ MySQL + Redis delete complete. Redis deleted: ${redisDelResult > 0}`);
    } else {
      console.warn(`⚠️ No record found in MySQL table "${mysqlTable}" for productId: ${productId}`);
    }

    return { success: true, message: 'Delete operation completed' };

  } catch (err) {
    console.error(`🔥 Error during deleteRedisAndMySQL: ${err.message}`);
    return { success: false, message: err.message };

  } finally {
    if (conn) conn.release();
    // Do NOT call redisClient.release() unless it's a pooled client (like ioredis cluster)
    // If redisClient is a regular Redis instance, just leave it open (or close it when app shuts down)
  }
};


async function addNewCandy_function(addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing ){

  
  
//  const connection = await mysqlPool.createConnection(); // Get a connection from the pool


// Process each part as needed

//res.json({ message: 'Data received successfully' });

// await mysqlPool.beginTransaction(); // Start the transaction

// Example of logging each part
console.log("" + ' \n Add Product Request:', addProductListRequest);

console.log("" + '\n Add Yummy Request:', addProductPricingRequest);

console.log("" + '\n Add Available Items:', addAvailableItemsRequest);

console.log("" + '\n Add Price Tracing:', addPriceTracing);

// Create DB connection


const productResult = await addProductRecord(addProductListRequest);
const yummyResult = await addYummyRecord(addProductPricingRequest);
const available_itemsResult = await addAvailableItems(addAvailableItemsRequest)
const price_tracing_Result = await addPriceTrace(addPriceTracing);


// Example of logging each part
console.log(productResult + ' \n Add Product Request:', addProductListRequest);

console.log(yummyResult + '\n Add Yummy Request:', addProductPricingRequest);

console.log(available_itemsResult + '\n Add Available Items:', addAvailableItemsRequest);

console.log(price_tracing_Result + '\n Add Price Tracing:', addPriceTracing);


}
const deleteItem = async (req, res) => {

   logRequestDetails(req, "deleteItem");

  const { productId } = req.body;
  console.log(`${getLongTime()}: 🧹 Deleting productId: [${productId}]`);

  try {
    await deleteAllProductData(productId, redisClient);
    const msg = `🗑️ Product ID [${productId}] deleted successfully`;
    console.log(`${getLongTime()}: ${msg}`);
    return   logResponseDetails(req, res,  {
        status: 200, success: true, message: msg });

  } catch (error) {
    const errMsg = `${getLongTime()}: ❌ Failed to delete productId [${productId}]: ${error}`;
    console.error(errMsg);
  return logResponseDetails(req, res, {
      status: 500,
     success: false, message: errMsg });
  }
};


// Reusable function to insert product records
async function addProductRecord(addProductListRequest, mySqlConnection) {
    console.log(getLongTime()+": addProductRecord called..!")



const prodId = addProductListRequest.productId;
const newProductName = addProductListRequest.productName;
const newProducFlavor = addProductListRequest.productFlavor;
const newProductPrice = addProductListRequest.productPrice;
const newProductImageURL =  addProductListRequest.image_url;
const key = "productList"
  const query = `INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      productName = VALUES(productName),
      productFlavor = VALUES(productFlavor),
      productPrice = VALUES(productPrice),
      image_url = VALUES(image_url)`;
  const pgInsertQuery = `
    INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (productId) DO UPDATE SET
      productName = EXCLUDED.productName,
      productFlavor = EXCLUDED.productFlavor,
      productPrice = EXCLUDED.productPrice,
      image_url = EXCLUDED.image_url
  `;

const replacements = [addProductListRequest.productId, addProductListRequest.productName,addProductListRequest.productFlavor,addProductListRequest.productPrice, addProductListRequest.image_url];

// Execute the query
// const result = await mysqlPool.query(query, replacements);

try {

 
  const result = addCachedAndQuery(key,query, replacements, mySqlConnection);
   return result;
  //const removedKey = removeData(key);
  //const returnedAddCach = getCachedOrQuery()
  
} catch (error) { 

  await mySqlConnection.rollback();
  console.log(`❌ Failed: Rolleback occured on key [${key}] \n ${error}`);
  throw `Exception on ${key} \n ${error} `;
  
}



}

// Reusable function to insert yummy records
async function addYummyRecord(addProductPricingRequest, mySqlConnection) {
    console.log("addYummyRecord called..!")

  console.log("addYummyRecord \n "+ addProductPricingRequest);
  const key = "productPricing";
  const query = `INSERT INTO productPricing (productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      costPerItem = VALUES(costPerItem),
      sellingPrice = VALUES(sellingPrice),
      productCommission = VALUES(productCommission),
      productProfit = VALUES(productProfit),
      productQuantity = VALUES(productQuantity),
      productSize = VALUES(productSize)`;
  const pgInsertQuery = `
    INSERT INTO productPricing (productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  const replacements = [
    addProductPricingRequest.productId,
    addProductPricingRequest.costPerItem,
    addProductPricingRequest.sellingPrice,
    addProductPricingRequest.productCommission,
    addProductPricingRequest.productProfit,
    addProductPricingRequest.productQuantity,
    addProductPricingRequest.productSize
  ];

try {

  const result = addCachedAndQuery(key,query, replacements, mySqlConnection);
  return result;
  
} catch (error) {

  await mySqlConnection.rollback();
  console.log(`❌ Failed: Rolleback occured on key [${key}] \n ${error}`);
  throw `Exception on ${key} \n ${error} `;
  
}
}

// Reusable function to insert available items
async function addAvailableItems(addAvailableItemsRequest, mySqlConnection) {
  console.log("addAvailableItems called..!")
  const key = "availableItems";
  const query = `INSERT INTO availableItems (productId, itemsRemaining, lastUpdated) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      itemsRemaining = VALUES(itemsRemaining),
      lastUpdated = VALUES(lastUpdated)`;
  const pgInsertQuery = `
    INSERT INTO availableItems (productId, itemsRemaining, lastUpdated)
    VALUES ($1, $2, $3)
  `;
  const replacements = [
    addAvailableItemsRequest.productId,
    addAvailableItemsRequest.itemsRemaining,
    addAvailableItemsRequest.lastUpdated
  ];

try {

  const result = addCachedAndQuery(key,query, replacements, mySqlConnection);
  return result;
  
} catch (error) {

  await mySqlConnection.rollback();
  console.log(`❌ Failed: Rolleback occured on key [${key}] \n ${error}`);
  throw `Exception on ${key} \n ${error} `;
  
}
}

// Reusable function to insert price tracing records
async function addPriceTrace(addPriceTracing, mySqlConnection) {

  const key = "priceTracing";
  const query = `INSERT INTO priceTracing (productId, accAmount, date) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      accAmount = VALUES(accAmount),
      date = VALUES(date)`;
  const pgInsertQuery = `
    INSERT INTO priceTracing (productId, accAmount, date)
    VALUES ($1, $2, $3)
  `;
  const replacements = [
    addPriceTracing.productId,
    addPriceTracing.accAmount,
    addPriceTracing.lastUpdated
  ];

  try {
 
  const result = addCachedAndQuery(key,query, replacements, mySqlConnection);
  return result;
  
} catch (error) {

  await mySqlConnection.rollback();
  console.log(`❌ Failed: Rolleback occured on key [${key}] \n ${error}`);
  throw `Exception on ${key} \n ${error} `;
  
}
}

async function deleteAvailableItems(productId){

  const data = await mysqlPool.query('DELETE FROM availableItesms WHERE productId = :productId', {
    replacements: { productId },
}); 
return data;
}

async function deleteCartList(productId){

  const data = await mysqlPool.query('DELETE FROM cartList WHERE productId = :productId', productId); 
return data;
}

async function deleteEstimates(productId){
  const data = await mysqlPool.query('DELETE FROM estimates WHERE productId = :productId', productId); 
return data;
}

async function deletePriceTracing(productId){

  const data = await mysqlPool.query('DELETE FROM priceTracing WHERE productId = :productId', productId); 

return data;
}

async function deleteStockItems(productId){

  const data = await mysqlPool.query('DELETE FROM stockItems WHERE productId = :productId', productId); 
return data;

}

async function deleteProductItemPricing(productId){
  const data = await mysqlPool.query('DELETE FROM productPricing WHERE productId = :productId', productId); 
return data;

}

async function deleteProductList(productId){
  const data = await mysqlPool.query('DELETE FROM productList WHERE productId = :productId', productId); 
return data;

}


export default {addNewCandy, addNewCandy_with_image, deleteItem, updateProducts_Batch}