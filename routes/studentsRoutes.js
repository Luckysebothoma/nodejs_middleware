const express = require("express");
const { Model } = require("sequelize");
const { Module } = require("module");
const { getStudentByID, createStudent, updateStudent, deleteStudent } = require("../controller/studentController");
const { getProductList, getProductByID, updateProduct, deleteProduct, addProduct , purgingProduct} = require("../controller/productController");
const { getCartList, add2Cart, deleteCart } = require("../controller/cartController");
const { getPricingList, updatePricingList, updateProductPricing } = require("../controller/pricingController");
const { add2Pricing } = require("../controller/pricingController");
const { getYummyList } = require("../controller/pricingController");
const { updatePricing } = require("../controller/pricingController");
const { deletePricing } = require("../controller/pricingController");
const { addStock, addStockedItems, removeStockedItems, deleteStock } = require("../controller/stockItemController");
const { addAvailableItems, getAvailableItems, updateAvailableItems, removeAvailableItemsById } = require("../controller/availableItemsController");
const { addSodEodItems, deleteSodEodItems, getSodEodItems, updateSodEodItems, removeSodEodById, getSodEodList, addSodEodList } = require("../controller/sod_eodController");
const { addEstimates, getEstimates, updateEstimates, removeEstimateById } = require("../controller/estimateController");
const { addPriceTracing, getPriceTracing, updatePriceTracing, removePriceTracing } = require("../controller/priceTracingController");
const { addProductItemPricing, getProductItemPricingList, updateProductItemPricing, createProductItemPricing } = require("../controller/productItemPricing");
const { addNewCandy } = require("../controller/bulkTransactionController");
const { uploadImages, uploadMiddleware} = require("../controller/uploadImages");

// Iamge
const imageService = require("../services/imageService");
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// ROuter OBj
const router = express.Router();

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

// Upload Image

// Update image
router.put('/:id', upload.single('image'), async (req, res) => {
  const { originalname, mimetype, size, buffer } = req.file;
  if(!originalname || !mimetype || !size || !buffer )
    console.log("Error: Missing Image field")
  await imageService.updateImage(req.params.id, { filename: originalname, mimetype, size, buffer });
  res.json({ message: 'Updated' });
});


// Price Tracing
router.post("/addPriceTracing", addPriceTracing);
router.get("/getPriceTracing", getPriceTracing);
router.put('/updatePriceTracing', updatePriceTracing);
router.delete('/removePriceTracing/:id', removePriceTracing)



// Product Item Pricing
router.post("/addProductItemPricing", addProductItemPricing );
router.get("/getProductItemPricing",getProductItemPricingList );
router.put('/updateProductItemPricing', updateProductItemPricing);

// stock
router.post('/addStock', addStock);
router.post('/addStockedItems', addStockedItems);
router.delete('/deleteStock/:id', deleteStock)
router.delete('/removeStockedItems/:id', removeStockedItems)


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

// Transactions




// Delete Product ID in all sections



// Adding Stock Items 


/// Adding SOD 

module.exports = router;