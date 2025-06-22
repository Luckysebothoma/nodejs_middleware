import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const upload = multer();

// Redis client setup
import { get, setEx } from "../config/redisClient";
//redisClient.connect(); // Ensure Redis is connected

router.get('/temp/:id', async (req, res) => {
  const key = `temp:image:${req.params.id}`;
  const data = await get(key);
  if (!data) return res.status(404).json({ message: 'Image not found or expired' });

  try {
      const parsed = JSON.parse(data);
    const imgBuffer = Buffer.from(parsed.buffer, 'base64');

  res.set('Content-Type', parsed.mimetype);
  res.send(imgBuffer);
  } catch (error) {
    res.send("Error")
  }
});

// POST /images/temp - Upload image to Redis only
router.post('/temp', upload.single('image'), async (req, res) => {
  
  const { originalname, mimetype, buffer, size } = req.file || {};
  const { headers, method, url, body } = req;
  const logObj = {
    file: { originalname, mimetype, size },
    request: { method, url, headers, body }
  };
  console.log("Time to upload images with following structure:", logObj);
  try {
    if (!req.file) return res.status(400).json({ message: 'No image provided' });

    const imageId = uuidv4();
    const key = `temp:image:${imageId}`;

    const imageData = {
      buffer: req.file.buffer.toString('base64'), // Store as base64
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    };

    // Set with TTL (e.g., 10 minutes)
    await setEx(key, 600, JSON.stringify(imageData));
    return key;
    
  } catch (err) {
    console.error('Redis upload error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
