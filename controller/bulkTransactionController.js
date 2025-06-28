import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;


import { getConnection, mysqlPool } from '../config/db.js'


const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;

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
        res.status(200).send({ success: true, message: 'All records added successfully!' });
    
      } catch (error) {
        // If an error occurs, rollback the transaction
        await connection.rollback();
        console.error('Transaction failed, rolled back:', error);
        res.status(500).send({ success: false, message: 'Transaction failed', error });
      } finally {
        connection.release(); // Release the connection back to the pool
      }

    };

*/

const addNewCandy_with_image = async(req,res) => {
  console.log("addNewCandy_with_image Started")
  const { addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing, file } = req.body;

  // You can now use these variables as needed
  // Example: pass them to your function
  addNewCandy_function(addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing);
  console.log("DOne Adding product, Now adding image")

  //Create mysql insert statement
  // Example: Insert uploaded image metadata into a table called 'product_images'
  // Assuming 'file' contains: { filename, mimetype, size }
  const imageInsertQuery = `
    INSERT INTO images (filename, mimetype, size, created_at)
    VALUES (?, ?, ?, NOW())
  `;
  const imageReplacements = [
    file.filename,
    file.mimetype,
    file.size
  ];

  addCachedAndQuery("images", imageInsertQuery,imageInsertQuery,imageReplacements);


  //await mysqlPool.query(imageInsertQuery, imageReplacements);
  
}
const addNewCandy = async(req, res) =>{

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

  

} catch (error) {
  await connection.rollback(); // Always await rollback
  const errorMessage = `${getLongTime()}: 🔥 Rollback Operation: ${error}`;
  
  console.error(errorMessage);

  if (!res.headersSent) {
    return res.status(500).send({ success: false, message: errorMessage });
  }

} finally {
  connection.release();

  // ✅ Only send success if no headers have been sent (not in error)
  if (!res.headersSent) {
    return res.status(200).send({
      success: true,
      message: `${getLongTime()}: Operation completed successfully`,
    });
  }
}



}
async function addNewCandy_function(addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing ){

  
  
//  const connection = await mysqlPool.createConnection(); // Get a connection from the pool


// Process each part as needed

res.json({ message: 'Data received successfully' });

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
const deleteItem = async(req, res) =>{

const {productId} = req.body;

  console.log("Product Id [" + productId + "] to be removed")

try{
const deleteAvailableResults = await deleteAvailableItems(productId);
const CartListResults = await deleteCartList(productId);
const deleteEstimatesResults = await deleteEstimates(productId);
const deletePriceTracingResults = await deletePriceTracing(productId);
const deleteProductItemPricingResults = await deleteProductItemPricing(productId);
const deleteStockItemsResults = await deleteStockItems(productId);


//delete productlist
// delet yummylist

  

res.status(200).send({
  success:true,
  message:"ID [" + productId +"] DELETED \n "+ deleteStockItemsResults + "\n"
  + CartListResults + "\n"
  + deleteEstimatesResults + "\n"
  + deletePriceTracingResults + "\n"
  + deleteProductItemPricingResults + "\n"
  + deleteStockItemsResults + "\n" 
})

}catch (error) {
  console.log(error)
  res.status(500).send({
      success:false,
      message:"Something happening while trying to delete",
      error
  })
  
}  


}

// Reusable function to insert product records
async function addProductRecord(addProductListRequest, mySqlConnection) {
    console.log(getLongTime()+": addProductRecord called..!")



const prodId = addProductListRequest.productId;
const newProductName = addProductListRequest.productName;
const newProducFlavor = addProductListRequest.productFlavor;
const newProductPrice = addProductListRequest.productPrice;
const newProductImageURL =  addProductListRequest.image_url;
const key = "productList"
  const query = `
  INSERT INTO productList (productId, productName,productFlavor,productPrice, image_url)
  VALUES (?, ?, ?, ?, ?)
`;
const pgInsertQuery = `
  INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url)
  VALUES ($1, $2, $3, $4, $5)
`;

const replacements = [addProductListRequest.productId, addProductListRequest.productName,addProductListRequest.productFlavor,addProductListRequest.productPrice, addProductListRequest.image_url];

// Execute the query
// const result = await mysqlPool.query(query, replacements);

try {


  const result = addCachedAndQuery(key,query,pgInsertQuery, replacements, mySqlConnection);
  return result;
  
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
  const query = `
    INSERT INTO productPricing (productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
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

  const result = addCachedAndQuery(key,query,pgInsertQuery, replacements, mySqlConnection);
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
  const query = `
    INSERT INTO availableItems (productId, itemsRemaining, lastUpdated)
    VALUES (?, ?, ?)
  `;
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

  const result = addCachedAndQuery(key,query,pgInsertQuery, replacements, mySqlConnection);
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
  const query = `
    INSERT INTO priceTracing (productId, accAmount, date)
    VALUES (?, ?, ?)
  `;
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

  const result = addCachedAndQuery(key,query,pgInsertQuery, replacements, mySqlConnection);
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


export default {addNewCandy, addNewCandy_with_image, deleteItem}