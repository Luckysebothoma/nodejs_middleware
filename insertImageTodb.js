const express = require('express');
const mysql = require('mysql');
const fs = require('fs');

const app = express();
const port = 3000;

// MySQL connection configuration
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'mini',
    password: '@mini.17',
    database: 'yummies'
});

// Connect to MySQL
connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL database');
});

// Endpoint to upload multiple images
app.post('/upload', (req, res) => {
    // List of image file paths
    const imagePaths = ['/Desktop/ssh/amazing-animal-paintings/src/assets/images/Product_01.jpg', '/Desktop/ssh/amazing-animal-paintings/src/assets/images/Product_02.jpg']; // Update with your image paths

    // Insert each image into the database
    imagePaths.forEach((filePath) => {
        // Read image data from file
        const imageData = fs.readFileSync(filePath);

        // Insert image data into database
        const query = 'INSERT INTO images (image_data) VALUES (?)';
        connection.query(query, [imageData], (err, result) => {
            if (err) {
                console.error('Error inserting image:', err);
            } else {
                console.log('Image uploaded successfully');
            }
        });
    });

    res.status(200).send('Images uploaded successfully');
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
O
