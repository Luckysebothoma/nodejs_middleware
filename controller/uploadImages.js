import multer, { memoryStorage } from "multer";

 
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';
 import { getConnection } from '../config/db.js';

 

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
    return logResponseDetails(req, res,{message: 'No files uploaded' }, cacheKey, 400);
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

      const query_pg= `
        INSERT INTO ${tableName} (filename, mimetype, size, image_data, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (filename) DO UPDATE SET
          mimetype = EXCLUDED.mimetype,
          size = EXCLUDED.size,
          image_data = EXCLUDED.image_data,
          created_at = NOW()
      `;

            const query = `
        INSERT INTO ${cacheKey} (filename, mimetype, size, image_data, created_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          mimetype = VALUES(mimetype),
          size = VALUES(size),
          image_data = VALUES(image_data),
          created_at = NOW()
      `;

      const values = [originalname, mimetype, size, buffer];

      const connection = getConnection(); 
      const [rsult] = addCachedAndQuery(cacheKey, query, values, connection)
      //await pgClient.query(query, values);

      logResponseDetails(req, res, rsult, cacheKey, 200)
      uploadedResults.push({
        filename: originalname,
        size,
        mimetype,
        status: 'uploaded'
      });

      console.log(`✅ Uploaded: ${originalname}`);
    }

 //   return res.status(200).json({
 //     message: 'Images uploaded successfully',
 //     uploaded: uploadedResults
 //   });

  } catch (error) {
    console.error('❌ Error uploading images:', error);
    return logResponseDetails(req, res, {
      message: 'Image upload failed',
      error: error.message
    },cacheKey, 500);
  }
};


export default { uploadMiddleware, uploadImages };
