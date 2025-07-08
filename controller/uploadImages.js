import multer, { memoryStorage } from "multer";
import TimeUtils from '../utils/Time.js';
import ControllerHandler from "../utils/ControllerHandler.js";
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import fs from 'fs'
import path from 'path'
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';



const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;

 
const cacheKey = "images";

// Configure Multer to store files in memory
const storage = memoryStorage();
const upload = multer({ storage });

// Middleware for handling file uploads
// 'array' specifies multiple files under the field name 'images'
const uploadMiddleware = upload.array('images');

// The uploadImages function now works with multiple files
import { pgClient } from '../config/postgres.js'; // Make sure this points to your pgClient setup
 
export const uploadImages = async (req, res) => {
  logRequestDetails(req, "uploadImages");

  const files = req.files;
  const cacheKey = req.body.table || 'images'; // Default to "images" table

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ message: 'No files uploaded' });
  }

  // Sanitize table name to avoid SQL injection
  const tableName = cacheKey.replace(/[^a-zA-Z0-9_]/g, '');

  const uploadedResults = [];

  try {
    for (const file of files) {
      const { originalname, mimetype, size, buffer } = file;

      if (!originalname || !buffer || !mimetype) {
        console.warn('Skipping invalid file:', file);
        continue;
      }

      console.log(`Uploading image: ${originalname}`);

      const query = `
        INSERT INTO ${tableName} (filename, mimetype, size, image_data, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (filename) DO UPDATE SET
          mimetype = EXCLUDED.mimetype,
          size = EXCLUDED.size,
          image_data = EXCLUDED.image_data,
          created_at = NOW()
      `;

      const values = [originalname, mimetype, size, buffer];

      await pgClient.query(query, values);

      uploadedResults.push({
        filename: originalname,
        size,
        mimetype,
        status: 'uploaded'
      });

      console.log(`✅ Uploaded: ${originalname}`);
    }

    return res.status(200).json({
      message: 'Images uploaded successfully',
      uploaded: uploadedResults
    });

  } catch (error) {
    console.error('❌ Error uploading images:', error);
    return res.status(500).json({
      message: 'Image upload failed',
      error: error.message
    });
  }
};


export default { uploadMiddleware, uploadImages };
