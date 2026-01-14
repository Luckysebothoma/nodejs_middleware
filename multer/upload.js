// config/multer.js
const multer = require('multer');

// Use memory storage for storing files in memory (buffer)
const storage = multer.memoryStorage();

// Set up multer for handling multiple file uploads
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB file size limit (adjust as needed)
}).array('images', 10); // Accepts up to 10 files, adjust as needed

module.exports = upload;
