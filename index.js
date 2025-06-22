// Clean and Modular Express Server
import express from "express";
import morgan from "morgan";
import cors from "cors";
import multer, { diskStorage } from "multer";
import { config } from "dotenv";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, extname } from "path";
import { createServer } from "https";
import { createServer as createHttpServer } from "http";
import cluster from "cluster";
import { cpus } from "os";
import { v4 as uuidv4 } from "uuid";
import { auth } from "express-oauth2-jwt-bearer";
import path from 'path';
import { fileURLToPath } from 'url';

// 👇 Needed for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
  Pushgateway
} from "prom-client";

// Redis utilities
import {
  redisClient,
  setData as set,
  getData as get
} from "./config_redis/redis_config.js";

// Time utils
import TimeUtils from "./utils/Time.js";
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

// Load env vars
config();
const app = express();

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
const register = new Registry();
collectDefaultMetrics({ register });

const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request durations",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5]
});
const redisStatus = new Gauge({
  name: "redis_connection_status",
  help: "Redis connection status"
});
const componentErrors = new Counter({
  name: "component_errors_total",
  help: "Component error count",
  labelNames: ["component", "error_type"]
});

register.registerMetric(httpDuration);
register.registerMetric(redisStatus);
register.registerMetric(componentErrors);


import studentsRoutes from "./routes/studentsRoutes.js";
//import tempImage from "./routes/tempImage.js"

app.use('/api/v1/student', studentsRoutes);
//app.use('/temp',tempImage)


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
    await setData(key, JSON.stringify(imageData));
    return key;
    
  } catch (err) {
    console.error('Redis upload error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Routes
app.get("/", (req, res) => {
    console.log(`${getShortTime(new Date())} ${req.path} endpoint hit`)

  res.status(200).send("Hello World!");
});

app.get("/metrics", async (req, res) => {
  console.log(`${getShortTime(new Date())} ${req.path} endpoint hit`)
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Upload logic
const uploadDir = join("uploads");
if (!existsSync(uploadDir)) mkdirSync(uploadDir);

const storage = diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${file.fieldname}-${Date.now()}${extname(file.originalname)}`)
});
const upload = multer({ storage });

app.post("/images/temp", upload.single("file"), async (req, res) => {
    console.log(`${getShortTime(new Date())} ${req.path} endpoint hit`)

  const key = req.query.key;
  if (!req.file || !key) return res.status(400).json({ error: "Missing file or key" });

  const imageData = {
    buffer: readFileSync(req.file.path).toString("base64"),
    mimetype: req.file.mimetype,
    originalname: req.file.originalname
  };

  try {
    await set(key, JSON.stringify(imageData));
    res.status(200).json({ message: "Image stored in Redis", key });
  } catch (err) {
    res.status(500).json({ error: "Redis error" });
  }
});
import redisConfig from './config_redis/redis_config.js';
const { removeData, setData, getData, keyExists,  setDataWithNoExpiry} = redisConfig;

// POST /sortedAsRedisKey
app.post('/sortedAsRedisKey', upload.single('file'), async (req, res) => {
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
    console.log('Uploaded Files:', files);
    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }
    res.status(200).json({ message: 'Images uploaded successfully', files });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// Static files for uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.get("/images/temp", async (req, res) => {
    console.log(`${getShortTime(new Date())} ${req.path} endpoint hit`)

  const key = req.query.key;
  if (!key) return res.status(400).json({ error: "Missing key" });

  const data = await get(key);
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

      const redisKey = `image:${Date.now()}:${file.originalname}`;
      await redis.set(redisKey, base64Data);
      await redis.zadd('uploadedFilesSorted', Date.now(), redisKey);

      fs.unlinkSync(file.path);
      uploadedKeys.push(redisKey);
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

startWorkerProcesses(app, credentials);
