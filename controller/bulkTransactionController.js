const mysqlPool = require("../config/db")
const addCachedAndQuery = require("../utils/ControllerHandler")

/*
const addNewCandy = async(req, res) =>{
    const connection = await mysqlPool.getConnection(); // Get a connection from the pool
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


const addNewCandy = async(req, res) =>{

  const { addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing } = req.body;
  
  
//  const connection = await mysqlPool.createConnection(); // Get a connection from the pool


// Process each part as needed

res.json({ message: 'Data received successfully' });

// await mysqlPool.beginTransaction(); // Start the transaction

// Example of logging each part
console.log("" + ' \n Add Product Request:', addProductListRequest);

console.log("" + '\n Add Yummy Request:', addProductPricingRequest);

console.log("" + '\n Add Available Items:', addAvailableItemsRequest);

console.log("" + '\n Add Price Tracing:', addPriceTracing);


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

try{
const deleteAvailableResults = deleteAvailableItems(productId);
const CartListResults = deleteCartList(productId);
const deleteEstimatesResults =deleteEstimates(productId);
const deletePriceTracingResults =deletePriceTracing(productId);
const deleteProductItemPricingResults =deleteProductItemPricing(productId);
const deleteStockItemsResults =deleteStockItems(productId);


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
async function addProductRecord(addProductListRequest) {



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

const result = addCachedAndQuery.addCachedAndQuery(key,query,pgInsertQuery, replacements);
// Execute the query
// const result = await mysqlPool.query(query, replacements);


return result;

}

// Reusable function to insert yummy records
async function addYummyRecord(addProductPricingRequest) {
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

  const result = addCachedAndQuery.addCachedAndQuery(key, query, pgInsertQuery, replacements);

  return result;
}

// Reusable function to insert available items
async function addAvailableItems(addAvailableItemsRequest) {
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

  const result = addCachedAndQuery.addCachedAndQuery(key, query, pgInsertQuery, replacements);

return result;
}

// Reusable function to insert price tracing records
async function addPriceTrace(addPriceTracing) {

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

  const result = addCachedAndQuery.addCachedAndQuery(key, query, pgInsertQuery, replacements);

return result;
}

async function deleteAvailableItems(productId){

  const data = await mysqlPool.query('DELETE FROM availableItesms WHERE productId = :productId', {
    replacements: { productId },
}); 
return data;
}

async function deleteCartList(productId){

  const data = await mysqlPool.query('DELETE FROM cartList WHERE productId = :productId', replacements); 
return data;
}

async function deleteEstimates(productId){
  const data = await mysqlPool.query('DELETE FROM estimates WHERE productId = :productId', replacements); 
return data;
}

async function deletePriceTracing(productId){

  const data = await mysqlPool.query('DELETE FROM priceTracing WHERE productId = :productId', replacements); 

return data;
}

async function deleteStockItems(productId){

  const data = await mysqlPool.query('DELETE FROM stockItems WHERE productId = :productId', replacements); 
return data;

}

async function deleteProductItemPricing(productId){
  const data = await mysqlPool.query('DELETE FROM productPricing WHERE productId = :productId', replacements); 
return data;

}

async function deleteProductList(productId){
  const data = await mysqlPool.query('DELETE FROM productList WHERE productId = :productId', replacements); 
return data;

}


module.exports = {addNewCandy, deleteItem}