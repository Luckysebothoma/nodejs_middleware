import { Router } from "express"; 
import productController from "../controller/productController.js";
const { getProductList, getProductByID, updateProduct, deleteProduct, addProduct, purgingProduct } = productController;


import cartController from "../controller/cartController.js";
const { getCartList, add2Cart, deleteCart } = cartController;
import pricingController from "../controller/pricingController.js";
const { deletePricing, getPricingList, add2Pricing, getYummyList, updateProductPricing, updatePricingList } = pricingController;

import stockItemController from "../controller/stockItemController.js";
const { addStock, addStockedItems, removeStockedItems, deleteStock } = stockItemController;

import availableItemsController from "../controller/availableItemsController.js";
const { addAvailableItems, getAvailableItems, updateAvailableItems, removeAvailableItemsById } = availableItemsController;

import sodEodController from "../controller/sod_eodController.js";
const { addSodEodItems, deleteSodEodItems, getSodEodItems, updateSodEodItems, removeSodEodById, getSodEodList, addSodEodList } = sodEodController;

import estimateController from "../controller/estimateController.js";
const { addEstimates, getEstimates, updateEstimates, removeEstimateById } = estimateController;

import priceTracingController from "../controller/priceTracingController.js";
const { addPriceTracing, getPriceTracing, updatePriceTracing, removePriceTracing } = priceTracingController;

import productItemPricingController from "../controller/productItemPricing.js";
const { addProductItemPricing, getProductItemPricingList, updateProductItemPricing, createProductItemPricing, deleteProductItemPricing } = productItemPricingController;

import bulkTransactionController, { deleteAllProductData } from "../controller/bulkTransactionController.js";
const { addNewCandy, addNewCandy_with_image, deleteItem, updateProducts_Batch , addListOfSodEod} = bulkTransactionController;

import uploadImagesController from "../controller/uploadImages.js";
const { uploadImages, uploadMiddleware } = uploadImagesController;

import { addDailyOps } from "../controller/addDailyOps.js";




// Iamge
//import imageService from "../services/imageService.js";
import multer, { memoryStorage } from 'multer';
const upload = multer({ storage: memoryStorage() });

// ROuter OBj
const router = Router();

//Princing  Estimates
//router.post("/uploadImages",uploadImages );
router.post("/uploadImages", uploadMiddleware, uploadImages);
//router.get("/getImages",getImages);
//router.get("/getImages/:id",getImagesById);
// app.post("/upload", upload.single("image"), uploadImage);

 
//Princing  Estimates
router.post("/addEstimates", addEstimates);
router.get("/getEstimates", getEstimates);
router.put("/updateEstimates", updateEstimates);
router.delete('/removeEstimateById/:id', removeEstimateById)

router.delete("/deleteProductbyId", deleteItem); 


router.delete("/deleteAllProductData/:id", deleteAllProductData);


router.post("/addListOfSodEod", addListOfSodEod)

// Upload Image

/*
// Update image
router.put('/:id', upload.single('image'), async (req, res) => {
console.log("Updating image for paramters:", req.params)
  const { originalname, mimetype, size, buffer } = req.file;
  
  if(!originalname || !mimetype || !size || !buffer )
    console.log("Error: Missing Image field")
  await imageService.updateImage(req.params.id, { filename: originalname, mimetype, size, buffer });
  res.json({ message: 'Updated' });
});
 */ 

// Price Tracing
router.post("/addPriceTracing", addPriceTracing);
router.get("/getPriceTracing", getPriceTracing);
router.put('/updatePriceTracing', updatePriceTracing);
router.delete('/removePriceTracing/:id', removePriceTracing)



// Product Item Pricing
router.post("/addProductItemPricing", addProductItemPricing );
router.get("/getProductItemPricing",getProductItemPricingList );
router.put('/updateProductItemPricing', updateProductItemPricing);
router.delete('/removeProductItemPricing/:id',deleteProductItemPricing)

// stock
router.post('/addStock', addStock);
router.post('/addStockItems', addStockedItems);
router.delete('/deleteStock/:id', deleteStock)
router.delete('/removeStockedItems/:id', removeStockedItems)


router.post('/addDailyOps', addDailyOps);

// SOD_EOD - ddSodEodItems, deleteSodEodItems, getSodEodItems, updateSodEodItems}
router.get('/getSodEodItems', getSodEodItems)
router.delete('/deleteSodEodItems/:id', deleteSodEodItems)
router.post('/addSodEodItems', addSodEodItems);
router.put('/updateSodEodItems', updateSodEodItems)
router.delete('/removeSodEodById/:id', removeSodEodById)

router.get('/getSodEodList', getSodEodList);
router.post('/addSodEodList',addSodEodList );


// availble
router.get('/getallAvailableItems', getAvailableItems)
router.put('/updateAvailableItems', updateAvailableItems)
router.post('/addAvailableItems', addAvailableItems);
router.delete('/removeAvailableItemsById/:id', removeAvailableItemsById)




//Routes For Products
router.get('/getProductList', getProductList);
router.get('/getProductBYId/:id', getProductByID);
router.put('/updateProductList', updateProduct); 
//router.delete('/deleteProduct/:id', deleteProduct);
router.delete('/deleteProduct/:id', deleteProduct);

router.post('/addProduct', addProduct);
router.delete('purgeProduct/:id', purgingProduct);

//Routes For Carts
router.get('/getallCart', getCartList);
router.post('/add2cart/', add2Cart);
router.delete('/deleteCart/:id', deleteCart);


// ROute for Pricing
//router.delete("/deletePricing", deletePricing);
router.delete("/deletePricing/:id", deletePricing);
router.get('/getallpricing',getPricingList);
router.post('/add2Pricing', add2Pricing);
router.get('/getYummies',getYummyList);
router.put('/updateProductPricing', updateProductPricing);
router.put('/updatePricingList', updatePricingList);


// Multiple Transactions 

    // Add New Candy

router.post('/addNewCandy', addNewCandy);
router.post("/addNewCandy_with_image", addNewCandy_with_image)
router.post('/updateProducts_Batch', updateProducts_Batch);


// Transactions




// Delete Product ID in all sections



// Adding Stock Items 


/// Adding SOD 

export default router;