// Clean and Modular Express Server
import express from "express";
import morgan from "morgan";
import cors from "cors";
import multer, { diskStorage } from "multer";
import { config } from "dotenv";
import { readFileSync, existsSync, mkdirSync } from "fs";
import  fs  from 'fs'
import { join, extname } from "path";
import { createServer } from "https";
import { createServer as createHttpServer } from "http";
import cluster from "cluster";
import { cpus } from "os";
import { v4 as uuidv4 } from "uuid";
import { auth } from "express-oauth2-jwt-bearer";
import path from 'path';
import { fileURLToPath } from 'url';
// Only use default import and destructuring
 

import { logRequestDetails, logResponseDetails } from './utils/requestLogger.js';



 

import ControllerHandler from "./utils/ControllerHandler.js"
const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;

const cacheKey = 'sodEodItems'; // Key to store the list in Redis



// 👇 Needed for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
  Pushgateway
} from "prom-client";


 

*/
import TimeUtils from "./utils/Time.js";

const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

// Load env vars
config();
const app = express();

app.use(express.urlencoded({ extended: true }));

// TLS Certs
const credentials = {
  key: readFileSync("/certs/key.key", "utf8"),
  cert: readFileSync("/certs/cert.crt", "utf8")
};

// Middleware
app.use(morgan("dev"));
app.use(express.json());

const allowedOrigins = [
  "https://192.168.0.140:4200",
  "https://192.168.0.123:4200",
  "https://linux-hp.local:4200",
  "https://linux-acer.local:4200",
  "https://sweety_acer.justdo-it.uk",
  "https://sweety.justdo-it.uk",
  "https://cli-app-angular-sweety-sweet.pages.dev",
  "https://sweety-sweet-app.lucky-sebothoma-3.workers.dev"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  optionsSuccessStatus: 200
}));

// Prometheus metrics
//const register = new Registry();
//collectDefaultMetrics({ register });



export const requestLoggerMiddleware = (req, res, next) => {
  logRequestDetails(req, '🌐 Global Request Logger');
  next();
};


import studentsRoutes from "./routes/studentsRoutes.js";
//import tempImage from "./routes/tempImage.js"

app.use('/api/v1/student', studentsRoutes);
//app.use('/temp',tempImage)

app.post('/update-product', async (req, res) => {

 
  
  const productListCacheKey = "productList"
  const { oldData, newData } = req.body;

  if (!oldData || !newData) {
    return res.status(400).json({ error: 'oldData and newData are required' });
  }

  const productId = newData.productId;

  try {

    // Save newData in MySQL - assume you have a table 'products' with columns matching newData keys
    const sql = `
      INSERT INTO products (productId, productName, productFlavor, productPrice, image_url)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        productName = VALUES(productName),
        productFlavor = VALUES(productFlavor),
        productPrice = VALUES(productPrice),
        image_url = VALUES(image_url)
    `;
//    const [result] = await pool.execute(sql, params);
      const [Redisresult] = await updateCachedOrQuery("product_backup:"+productListCacheKey, sql, sql, oldData);
      const [mySqlresult] = await updateCachedOrQuery(productListCacheKey, sql, sql, newData);


    return res.status(200).json({
      message: 'New data saved in MySQL, old data backed up in Redis',
      mysqlResult: result

    });

  } catch (err) {
    console.error('Error updating product:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



app.use("*", (req, res, next) => {
  logRequestDetails(req, `Accessed path: ${req.originalUrl}`);
  console.log("Headers:", req.headers);
  next();
});

// POST /images/temp - Upload image to Redis only
app.post('/images/temp-key', async (req, res) => {

   
  const { originalname, mimetype, buffer, size } = req.file || {};
  const { headers, method, url, body } = req;
  const logObj = {
    file: { originalname, mimetype, size },
    request: { method, url, headers, body }
  };
  console.log("Time to upload images with following structure:", logObj);
  try {
    if (!req.file) return res.status(400).json({ message: 'No image provided' });
    const filename = logObj.file.originalname;
    const imageId = uuidv4();
    const key = `temp:${filename}:${imageId}`;

    const imageData = {
      buffer: req.file.buffer.toString('base64'), // Store as base64
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    };

    // Set with TTL (e.g., 10 minutes)
  //  await setData(key, JSON.stringify(imageData));
  //  return key;
    
  res.status(200).json({ success: true });
  } catch (err) {
    console.error('Redis upload error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Routes
app.get("/", (req, res) => {

  
  res.status(200).send("Hello World!");
 
});


 

app.get('/metrics', async (req, res) => {
  try {
    logRequestDetails(req, "metrics");

    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    logResponseDetails(req, res, { status: 200, data: metrics });
    res.end(metrics);

  } catch (err) {
    logResponseDetails(req, res, { status: 500, error: err.message });
    res.status(500).end(err.message);
  }
});

// Upload logic
const uploadDir = join("uploads");
if (!existsSync(uploadDir)) mkdirSync(uploadDir);

const storage = diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${file.fieldname}-${Date.now()}${extname(file.originalname)}`)
});
const upload = multer({ dest: 'uploads/' }); // Will store file temporarily

app.post("/images/temp", upload.single("file"), async (req, res) => {
 

  const key = req.query.key;
  if (!req.file || !key) return res.status(400).json({ error: "Missing file or key" });

  const imageData = {
    buffer: readFileSync(req.file.path).toString("base64"),
    mimetype: req.file.mimetype,
    originalname: req.file.originalname
  };

  try {
    //await set(key, JSON.stringify(imageData));
   
    res.status(200).json({ message: "Image stored in Redis", key });
  } catch (err) {
    res.status(500).json({ error: "Redis error" });
  }


 
});
import updateRouter from "./routes/updateProductRoutemySql_Redis.js";

// POST /sortedAsRedisKey
/*app.post('/sortedAsRedisKey', upload.single('file'), async (req, res) => {
  console.log("logs for sortedAsRedisKey:",req)
  try {
    const { file } = req;

    if (!file) {
      return res.status(400).json({ error: 'No image uploaded.' });
    }

    const buffer = fs.readFileSync(file.path); // Read image file
    const redisKey = `image:${Date.now()}:${file.originalname}`;

    // Store image buffer in Redis as base64 string
    await setDataWithNoExpiry(redisKey, buffer.toString('base64'));
    
    // Optional: Add key to a sorted set for tracking
   // await redis.zadd('imageSortedSet', Date.now(), redisKey);

    // Cleanup local file
    fs.unlinkSync(file.path);

    res.status(200).json({ message: 'Image stored in Redis', key: redisKey });
  } catch (err) {
    console.error('❌ Error uploading image:', err);
    res.status(500).json({ error: 'Server error while uploading image' });
  }
});
*/



app.post('/sortedAsRedisKey', upload.single('blob'), async (req, res) => {
 

 
  try {
    const file = req.file;
    const redisKey = req.body.key;
    const base64FromBody = req.body.base64;

    if (!file) {
      return res.status(400).json({ error: '❌ No image blob received in formData.' });
    }

    if (!redisKey) {
      return res.status(400).json({ error: '❌ Redis key missing in formData.' });
    }

    console.log(`${getLongTime(new Date)} - 🖼️ Image Received:`, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    // Choose whether to use base64 from client or server-side conversion
    const buffer = file.buffer;
    const base64 = base64FromBody || buffer.toString('base64');

    // ✅ Store in Redis
    //await setDataWithExpiry(redisKey, base64);
    console.log(`${getLongTime(new Date)} - ✅ Image stored in Redis under key: ${redisKey}`);

    res.status(200).json({ message: '✅ Image stored in Redis', key: redisKey });
  } catch (err) {
    console.error(`${Date.now()} - ❌ Error in /sortedAsRedisKey:`, err);
    res.status(500).json({ error: 'Server error while uploading image' });

  }
 
}


);



// Create a storage strategy
const storageImages = multer.diskStorage({
  destination: function (req, file, cb) {
 
    cb(null, 'uploads/'); // Directory to save files
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// Init multer
const uploada = multer({ storage: storageImages });

// Route: POST /upload
app.post('/upload', uploada.array('images', 10), (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }
    res.status(200).json({ message: 'Images uploaded successfully', files });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Server error', error: err });
  }
});

const upload_temp = multer({ dest: 'temp_uploads/' }); // temp folder (auto-created if missing)

app.post('/images/temp', upload_temp.single('file'), async (req, res) => {
  const timestamp = new Date().toISOString();

 

  try {
    const file = req.file;
    const { productId, productName, tag } = req.body;

    if (!file) {
      console.warn(`[${getLongTime(new Date)}] ❌ No file uploaded`);
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // ✅ Validation
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.mimetype)) {
      console.warn(`[${getLongTime(new Date)}] ❌ Invalid MIME type: ${file.mimetype}`);
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Only JPEG/PNG files are allowed.' });
    }

    if (file.size > 5 * 1024 * 1024) {
      console.warn(`[${getLongTime(new Date)}] ❌ File too large: ${file.size}`);
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'File size exceeds 5MB limit.' });
    }

    // ✅ Optional: Rename and store temporarily
    const tempDir = path.join('temp_uploads');
    const newFileName = `temp_${productId}_${Date.now()}_${file.originalname}`;
    const finalPath = path.join(tempDir, newFileName);

    fs.renameSync(file.path, finalPath);
    console.log(`[${getLongTime(new Date)}] ✅ Temp file stored as: ${finalPath}`);

    return res.status(200).json({
      message: '✅ Temp image uploaded',
      fileName: newFileName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      productId,
      productName,
      tag,
      storedPath: finalPath
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ Server error:`, err);
    return res.status(500).json({ error: 'Server error while uploading image.' });
  }
});

// Static files for uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.get('/api/images/:key', async (req, res) => {

 


  const { key } = req.params;
  const redisKey = `temp:${key}`;
  //const imageData = await redisClient.getBuffer(redisKey); // Redis must store binary as buffer

  if (!imageData) return res.status(404).send('Image not found');

  res.setHeader('Content-Type', 'image/png'); // or image/jpeg
  res.send(imageData);
});


app.get("/images/temp", async (req, res) => {
 
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: "Missing key" });

  //const data = await get(key);
  if (!data) return res.status(404).json({ error: "Not found" });

  const parsed = JSON.parse(data);
  res.set("Content-Type", parsed.mimetype);
  res.send(Buffer.from(parsed.buffer, "base64"));
});


// Store uploaded files in temp directory
const uploads = multer({ dest: 'uploads/' });


// 👇 Must match the key used in FormData: 'files'
app.post('/upload', upload.array('files'), async (req, res) => {
 
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const uploadedKeys = [];

    for (const file of files) {
      const buffer = fs.readFileSync(file.path);
      const base64Data = buffer.toString('base64');

      //const redisKey = `image:${Date.now()}:${file.originalname}`;
      //await redis.set(redisKey, base64Data);
      //await redis.zadd('uploadedFilesSorted', Date.now(), redisKey);

      fs.unlinkSync(file.path);
     // uploadedKeys.push(redisKey);
    }

    res.status(200).json({ message: 'Images uploaded', keys: uploadedKeys });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reusable cluster worker logic
function startWorkerProcesses(app, credentials) {
  const cpuCount = cpus().length;

  if (cluster.isPrimary) {
    console.log(`${getShortTime(new Date())} Master PID ${process.pid} with ${cpuCount} CPUs`);
    for (let i = 0; i < cpuCount - 1; i++) cluster.fork();

    cluster.on("exit", worker => {
      console.log(`${formattedDate()} Worker ${worker.process.pid} died, restarting...`);
      cluster.fork();
    });
  } else {
    createHttpServer(app).listen(80, () => {
      console.log(`${formattedDate()} Server running on http://localhost:80`);
    });

    createServer(credentials, app).listen(443, () => {
      console.log(`${formattedDate()} Server running on https://localhost:443`);
    });
  }
}

// 🛡️ Optional: error handling middleware
app.use((err, req, res, next) => {
  console.error('🔥 Global Error Handler:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

startWorkerProcesses(app, credentials);
