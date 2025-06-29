import { Router } from "express"; 
import productController from "../controller/productController.js";
const { getProductList, getProductByID, updateProduct, deleteProduct, addProduct, purgingProduct } = productController;


const updateRouter = Router();


//Routes For Products
updateRouter.get('/getProductList', getProductList);
updateRouter.get('/getProductBYId/:id', getProductByID);
updateRouter.put('/updateProductList', updateProduct); 
updateRouter.delete('/deleteProduct/:id', deleteProduct);
updateRouter.post('/addProduct', addProduct);
updateRouter.delete('purgeProduct/:id', purgingProduct);


export default updateRouter;

