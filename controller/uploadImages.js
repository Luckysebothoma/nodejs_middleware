import multer, { memoryStorage } from "multer";
import TimeUtils from '../utils/Time.js';
import ControllerHandler from "../utils/ControllerHandler.js";
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;

import { setData, getData } from "../config_redis/redis_config.js"

const cacheKey = "productImages";

// Configure Multer to store files in memory
const storage = memoryStorage();
const upload = multer({ storage });

// Middleware for handling file uploads
// 'array' specifies multiple files under the field name 'images'
const uploadMiddleware = upload.array('images');

// The uploadImages function now works with multiple files
const uploadImages = async (req, res) => {
    const files = req.files; // This assumes you've used upload.array()

    if (!files || files.length === 0) {
        return res.status(400).send({ message: 'No files uploaded' });
    }

    try {
        // Loop through each file and insert into the database
        for (const file of files) {
            const imageBuffer = file.buffer; // Image in binary format
            const imageName = file.originalname; // Image file name

            console.log(`Now uploading image: ${imageName}`);

            // Use Sequelize's query to insert data into MySQL
            const query = 'INSERT INTO productImages (image_url, image_content) VALUES (?, ?)';
            
            const replacements = [imageName, imageBuffer]
            await addCachedAndQuery(cacheKey,query,query,replacements)
            res.status(200).send({ message: `Image ${imageName} uploaded successfully` });
           

            console.log(`Image ${imageName} uploaded successfully.`);
        }

        // Fetch and cache the updated data
        const [data] = await dbSequelize.query('SELECT * FROM productImages');
        const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));
        await setData(cacheKey, objectsOnly, 3600); // Cache for 1 hour

        return res.status(200).send({ message: 'productImages uploaded successfully' });

    } catch (error) {
        console.error('Error uploading productImages:', error);
        return res.status(500).send({ message: 'Failed to upload productImages', error: error.message });
    }
};

export default { uploadMiddleware, uploadImages };
