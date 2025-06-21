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
app.use('/api/v1/student', studentsRoutes);
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
