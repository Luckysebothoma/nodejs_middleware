const express = require("express");
const color = require("colors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const redisClient = require("./config/redisClient")
const cors = require("cors");
const fs = require("fs");
const { v4: uuidv4 } = require('uuid');
const https = require("https"); 
const http = require("http");
const cluster = require("cluster");
const path = require("path");
const os = require("os");
const multer = require("multer");
const { auth } = require("express-oauth2-jwt-bearer");
const bodyParser = require('body-parser');
const client = require('prom-client');
const tempImageRoutes = require('./routes/tempImage');
const { Registry, Counter, Histogram, Gauge, collectDefaultMetrics, Pushgateway } = require ('prom-client'); 
const {getShortTime} = require("./utils/Time");
const { getCachedOrQuery } = require("./utils/ControllerHandler");
// Load environment variables
dotenv.config();
const TTL_SECONDS = 600 * 10; // 10 Mins x 10
// Certificate files for HTTPS
const privateKey = fs.readFileSync("/certs/key.key", "utf8");
const certificate = fs.readFileSync("/certs/cert.crt", "utf8");
const credentials = { key: privateKey, cert: certificate };

// Allowed origins for CORS
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

// CORS Options
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  optionsSuccessStatus: 200,
};

// JWT Check Middleware
const jwtCheck = auth({
  audience: "https://linux.justdo-it.local:8083",
  issuerBaseURL: "https://dev-3ocho460qagqipds.us.auth0.com/",
  tokenSigningAlg: "RS256",
});


  const app = express();
  app.use(bodyParser.json());
  app.use(morgan("dev"));
//  app.use(metricsMiddleware);
//  app.use('/metrics', metricsRoute);
//  app.use(frontendRoutes); // Mount frontend monitoring endpoints


const register = new client.Registry();
client.collectDefaultMetrics({ register });

// HTTP Request duration
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
});

// Redis Connection Status (0 = down, 1 = up)
const redisConnectionGauge = new client.Gauge({
  name: 'redis_connection_status',
  help: 'Redis connection status (1 = up, 0 = down)',
});

// Database Query Time
const dbQueryHistogram = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of DB queries in seconds',
  labelNames: ['query_type', 'table'],
  buckets: [0.005, 0.01, 0.1, 0.5, 1],
});

// Component success/failure counters
const componentSuccessCounter = new client.Counter({
  name: 'component_success_total',
  help: 'Number of successful component executions',
  labelNames: ['component'],
});

const componentErrorCounter = new client.Counter({
  name: 'component_errors_total',
  help: 'Number of errors from components',
  labelNames: ['component', 'error_type'],
});

register.registerMetric(httpRequestDuration);
register.registerMetric(redisConnectionGauge);
register.registerMetric(dbQueryHistogram);
register.registerMetric(componentSuccessCounter);
register.registerMetric(componentErrorCounter);


// Main Server Logic
if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  console.log( getShortTime(new Date) + `Master process running on PID ${process.pid} with ${numCPUs} CPUs`);

  for (let i = 0; i < numCPUs - 2; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker) => {
    console.log( getShortTime(new Date) + `Worker ${worker.process.pid} died. Starting a new worker...`);
    cluster.fork();
  });
} else {

  app.use(cors(corsOptions));



  // Endpoint to count all requests "*"
  app.use((req, res, next) => {

      // Log useful request fields
      const logFields = {
        method: req.method,
        url: req.originalUrl,
        baseUrl: req.baseUrl,
        path: req.path,
        headers: req.headers,
        body: req.body,
        ip: req.ip,
        hostname: req.hostname,
        query: req.query,
      };

  //    console.log(formattedDate() + " [Request Info]:", JSON.stringify(logFields, null, 2));

    next();
  });
  

  app.get("/", (req, res) => {
    res.status(200).send("Hello World...!!");
    console.log( getShortTime(new Date) + `\n\n ${formattedDate()} - Base: ${req.baseUrl} \n Hostname: ${req.hostname} \n Url: ${req.url}`);
    console.log( getShortTime(new Date) + `\n\n ${formattedDate()} - Incremented request counter for ${req.method} ${req.originalUrl}`);

  });
 


app.post('/frontend-console-log', (req, res) => {

  const { log } = req.body;
  console.log(formattedDate() + `[Frontend Log] 📘 ${log}`);
  res.status(200).send('Log received: '+ formattedDate());
  
});

app.post('/frontend-error', (req, res) => {
  const { componentName, value } = req.body;

  console.error(formattedDate() + `[Frontend Error] ❌ ${componentName}: ${value}`);

  componentErrorCounter.inc({
    component: componentName,
    error_type: 'frontend',
  });


  const frontendMetricRegistry = {}; // Store metrics to avoid duplicates

app.post('/frontend-metrics', (req, res) => {
  const { metricName, value, type = 'gauge', labels = {} } = req.body;
      console.log(req.pathUrl +  - "Cached")

  // Input validation
  if (!metricName || typeof value !== 'number') {
    return res.status(400).json({ error: 'Invalid metric payload' });
  }

  // Register metric if it doesn't exist
  if (!frontendMetricRegistry[metricName]) {
    if (type === 'counter') {
      frontendMetricRegistry[metricName] = new client.Counter({
        name: metricName,
        help: `Frontend counter metric: ${metricName}`,
        labelNames: Object.keys(labels),
      });
    } else if (type === 'gauge') {
      frontendMetricRegistry[metricName] = new client.Gauge({
        name: metricName,
        help: `Frontend gauge metric: ${metricName}`,
        labelNames: Object.keys(labels),
      });
    } else {
      return res.status(400).json({ error: `Unsupported metric type: ${type}` });
    }
  }

  const metric = frontendMetricRegistry[metricName];

  try {
    if (type === 'counter') {
      metric.inc(labels, value);
    } else {
      metric.set(labels, value);
    }

    res.status(200).json({ message: 'Frontend metric updated successfully' });
  } catch (err) {
    console.error(`❌ Error updating frontend metric ${metricName}:`, err);
    res.status(500).json({ error: 'Failed to update frontend metric' });
  }
});


   register.registerMetric(componentErrorCounter);
    console.log(formattedDate() + "componentErrorCounter:{" + componentErrorCounter +"} Registered");


  res.status(200).send(formattedDate() +'F: rontend error tracked');
});

app.post('/frontend-console-metric', (req, res) => {
  const { metricName, value, type = 'gauge', labels = {} } = req.body;

  if (!metricName || typeof value !== 'number') {
    return res.status(400).send(formattedDate() +': Invalid metric payload');
  }

  if (!customMetrics[metricName]) {
    if (type === 'gauge') {
      customMetrics[metricName] = new client.Gauge({
        name: metricName,
        help: `Frontend custom metric: ${metricName}`,
        labelNames: Object.keys(labels),
      });
      
      register.registerMetric(customMetrics[metricName]);
      console.log(formattedDate() + "customMetrics[metricName]:{" + customMetrics[metricName]+"} Registered");

    } else if (type === 'counter') {
      customMetrics[metricName] = new client.Counter({
        name: metricName,
        help: `Frontend custom counter: ${metricName}`,
        labelNames: Object.keys(labels),
      });
        
      register.registerMetric(customMetrics[metricName])
      console.log(formattedDate() + "customMetrics[metricName]:{" + customMetrics[metricName]+"} Registered")
    } else {
      return res.status(400).send(formattedDate() +': Unsupported metric type');
    }
  }

  const metric = customMetrics[metricName];

  if (type === 'gauge') {
    metric.set(labels, value);
  } else if (type === 'counter') {
    metric.inc(labels, value);
  }

  res.status(200).send(formattedDate() +': Frontend metric recorded');
});


  // Your JWT Check if needed
  // app.use(jwtCheck);

//   app.use('/api/v1/student', require('./routes/studentsRoutes'));


app.use('/api/v1/student', require('./routes/studentsRoutes'));
// ✅ Initialize `upload` BEFORE using it
const redisUpload = multer(); // or multer({ storage: ... }) if needed




    // ✅ Route definition after client is connected
    app.get('/api/image/:id', async (req, res) => {
      const productId = req.params.id;
      
      const key = `Product:Product_${productId}:base64`;


      try {
        const base64Image = await redisClient.get(key);

        if (!base64Image) {
          return res.status(404).json({ error: 'Image not found in Redis' });
        }

        // Return as-is, assuming it includes data URI prefix
        res.json({ base64: base64Image });
      } catch (err) {
        console.error('Error accessing Redis:', err);
        res.status(500).json({ error: 'Redis error', detail: err.message });
      }
    });

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
app.post('/sortedAsRedisKey', redisUpload.single('blob'), async (req, res) => {


  const redisKey = req.body.key;
  const base64Data = req.body.base64;
  const blobBuffer = req.file.buffer;
  const key = `product:${redisKey}`;


  // Example: Store both blob and base64 in Redis
//   await redisClient.set(`${redisKey}:blob`, blobBuffer);
//   await redisClient.set(`${redisKey}:base64`, base64Data);

await redisClient.set(`${key}:blob`, blobBuffer);
await redisClient.set(`${key}:base64`, base64Data);


  res.send({ message: redisKey + 'Stored successfully' });
});


const upload = multer({ dest: 'uploads/' }); // or your custom storage config
app.post('/images/temp', upload.single('file'), async (req, res) => {

    const key = req.query.key;
  // Log useful request fields
  const logFields = {
    method: req.method,
    url: req.originalUrl,
    baseUrl: req.baseUrl,
    path: req.path,
    headers: req.headers,
    body: req.body,
    ip: req.ip,
    hostname: req.hostname,
    query: req.query,
    key: key
  };

  console.log(formattedDate() + " [Request Info]:", JSON.stringify(logFields, null, 2));
  const imageId = uuidv4();
//  const key = `temp:image:${imageId}`;

//  const key = req.file.originalname;

  if (!req.file && !key) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const imageData = {
    
    buffer: fs.readFileSync(req.file.path).toString('base64'), // Store as base64
    mimetype: req.file.mimetype,
    originalname: req.file.originalname
  };
  console.log("Done Preparing Image " );
  try {
    await redisClient.set(key, JSON.stringify(imageData), 'EX', TTL_SECONDS);
    console.log("Done writing to Redis key[" +  key +"]");
    const ack = await redisClient.wait(1, 100); // wait for 1 replica to acknowledge within 100ms
    console.log("Redis response: "+ ack)
    return key;
  } catch (error) {
    console.log("Failed to write to Redis key[" +  key +"] " + error);
    return res.status(500).json({ error: 'Failed to store image in Redis' });
  }

 // res.status(200).json({ message: 'Image uploaded and stored', key });
});

app.get('/images/temp-key', (req, res) => {
  const imageId = uuidv4();
  const key = imageId;

  const logFields = {
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    ip: req.ip,
    generatedKey: key
  };

  console.log(formattedDate() + " [Generated Key]:", JSON.stringify(logFields, null, 2));
  res.status(200).json({ key });
});

app.get('/temp', async (req, res) => {
  
  const key = req.query.key; // Correctly get key from query parameters

  //  const key = req.params.key;
      // Log useful request fields
      
      const logFields = {
        method: req.method,
        url: req.originalUrl,
        baseUrl: req.baseUrl,
        path: req.path,
        headers: req.headers,
        body: req.body,
        ip: req.ip,
        hostname: req.hostname,
        query: req.query,
      };

      console.log(formattedDate() + "temp [Request Info]:", JSON.stringify(logFields, null, 2));
  const decodedKey = decodeURIComponent(key);
    const sanitizedKey = decodedKey.replace(/^temp:image:/, '');

  console.log("Now Reading key :" + key + " Decoded key: " + decodedKey + " Sanitized: " + sanitizedKey);

  // Wait for Redis replicas to acknowledge before reading (optional, usually used after writes)
  // Here, we just try to get the value and if not found, retry a few times
  let data = null;
  const maxRetries = 5;
  let attempt = 0;
  while (attempt < maxRetries) {
    data = await redisClient.get(decodedKey);
    if (data) break;
   
    await new Promise(resolve => setTimeout(resolve, 100)); // wait 100ms before retry
    attempt++;
     console.log(formattedDate() +" Attempt: "+ attempt+"] to get " + decodedKey)
  }

  console.log("redisClient data: " + data);
  if (!data) return res.status(404).json({ message: 'Image not found or expired' });

  console.log("CACHE HIT: Key " + key);

  const parsed = JSON.parse(data);
  const imgBuffer = Buffer.from(parsed.buffer, 'base64');

  res.set('Content-Type', parsed.mimetype);
  res.send(imgBuffer);
});

// Ensure the uploads directory exists

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer for file storage
const storage = multer.diskStorage({
  destination: uploadDir, // Save images in 'uploads' folder
  filename: (req, file, cb) => {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  },
});


  const pushGatewayUrl = process.env.PUSHGATEWAY_URL || 'http://pushgateway-container:9091'; // Default URL if not set
  const gateway = new Pushgateway(pushGatewayUrl); // Update with your Pushgateway URL

  if( !gateway) {
    console.error('Pushgateway is not defined. Please check your configuration.');
  }else{

    console.log(`Pushgateway is connected: ${pushGatewayUrl}`);

  }

function startTimer() {
  // Returns the current timestamp in milliseconds

  const start = formattedDate(Date.now());
  console.log(`\n\n ${start} - Starting timer...`);

  return Date.now();
}

function endTimer(start) {

  // Calculates the elapsed time in seconds
  const end = Date.now();
  const elapsed = (end - start) / 1000; // Convert milliseconds to seconds
  console.log(`\n\n ${formattedDate()} - Ending timer... Elapsed time: ${elapsed} seconds`);
  return elapsed;
}

function timeInMinutes(start, lapse, args) {
  // Calculate the elapsed time in minutes
   
  const elapsed = (lapse - start) / 60000; // Convert milliseconds to minutes
  console.log(`\n\n ${formattedDate(new Date) } - Elapsed time: ${elapsed} minutes`);
  return elapsed;
}

function formattedDate() {
  const options = {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };

  const formatter = new Intl.DateTimeFormat("en-ZA", options);
  const parts = formatter.formatToParts(new Date());
  const time = `${parts.find(p => p.type === "hour").value}:${parts.find(p => p.type === "minute").value}:${parts.find(p => p.type === "second").value}`;
  const date = `${parts.find(p => p.type === "day").value}-${parts.find(p => p.type === "month").value}-${parts.find(p => p.type === "year").value}`;
  
  return `${time}-${date}`;
}



/*
  // HTTPS 
  https.createServer(credentials, app).listen(8084, () => {

    console.log(`${new Date().toISOString()} - Node.js server is running on https://linux.justdo-it.local:8084`);

  });
*/

  // HTTP Server
  http.createServer(app).listen(80, () => {
    console.log(`${new Date().toISOString()} - Node.js server is running on http://linux.justdo-it.local:80`);
  });


    // HTTPS Server
    https.createServer(credentials, app).listen(443, () => {
      console.log(`${new Date().toISOString()} - Node.js server is running on https://linux.justdo-it.local:443`);
    });

} 