import multer from 'multer';
import { mysqlPool } from '../config/db.js';
import path from 'path';
import fs from 'fs';
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';


import ControllerHandler from "../utils/ControllerHandler.js";
import { query } from 'express';

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;


// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads/';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  
  filename: (req, file, cb) => {
    logRequestDetails(req, 'uploadImages')
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

export const uploadImage = [
  upload.single('image'),
  async (req, res) => {
    const { filename, originalname, mimetype, size, path: filePath } = req.file;

    try {
      const conn = await mysqlPool.getConnection();
     /* await conn.query(
        `INSERT INTO uploaded_images (filename, originalname, mimetype, size, path)
         VALUES (?, ?, ?, ?, ?)`,
        [filename, originalname, mimetype, size, filePath]
      );
      */
      const query = `INSERT INTO uploaded_images (filename, originalname, mimetype, size, path)
         VALUES (?, ?, ?, ?, ?)`
      const values =  [filename, originalname, mimetype, size, filePath]
      const [results] = await addCachedAndQuery('',query,values,conn);
        return logResponseDetails(req, res,{
            success:true,
            message:"Image added on database"
        },'uploaded_images',200)
      
      
    } catch (err) {
//      res.status(500).json({ error: err.message });
      return logResponseDetails(req, res,{ error: err.message },'uploaded_images',500)
    }finally{
        conn.release();
    }
  }
];
