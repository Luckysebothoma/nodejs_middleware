import { Client } from 'minio'
import crypto from 'crypto'

/**
 * MinIO client singleton
 */
let minioClient = null

/**
 * Initialize MinIO connection
 */
export function initMinioClient({
  endPoint = process.env.MINIO_HOST || 'localhost',
  port = parseInt(process.env.MINIO_PORT || '9000'),
  useSSL = process.env.MINIO_USE_SSL === 'true',
  accessKey = process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey = process.env.MINIO_SECRET_KEY || 'minioadmin'
} = {}) {
  try {
    minioClient = new Client({ endPoint, port, useSSL, accessKey, secretKey })
    console.log(`✅ MinIO client initialized → ${endPoint}:${port}`)
    
    return minioClient
  } catch (err) {
    console.error('❌ Failed to initialize MinIO client:', err.message)
    throw err
  }
}

/**
 * Check MinIO connection health
 */
export async function checkMinioConnection() {
  try {
    if (!minioClient) throw new Error('MinIO client not initialized')
    // Attempt a simple bucket list operation
    await minioClient.listBuckets()
    console.log('✅ MinIO connection OK')
    return true
  } catch (err) {
  

    console.error('❌ MinIO connection failed:', err.message)
    return false
  }
}

/**
 * Ensure a bucket exists, create if not
 */
export async function ensureBucket(bucketName) {
  try {
    if (!minioClient) throw new Error('MinIO client not initialized')

    const exists = await minioClient.bucketExists(bucketName).catch(() => false)
    if (!exists) {
      await minioClient.makeBucket(bucketName)
      console.log(`🪣 Created bucket: ${bucketName}`)
    }
  } catch (err) {
    console.error(`❌ Error ensuring bucket "${bucketName}":`, err.message)
  }
}

/**
 * Upload a log object to MinIO
 */
export async function uploadToMinio(bucketName, objectPrefix, logData) {
  try {
    if (!minioClient) throw new Error('MinIO client not initialized')

    await ensureBucket(bucketName)

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const objectName = `${objectPrefix.replace(/\//g, '_')}_${timestamp}_${crypto.randomUUID()}.json`

    const payload = Buffer.from(
      typeof logData === 'string' ? logData : JSON.stringify(logData, null, 2)
    )

    await minioClient.putObject(bucketName, objectName, payload)
    console.log(`✅ Log uploaded → ${bucketName}/${objectName}`)
    return { bucketName, objectName }
  } catch (err) {
    console.error(`❌ Failed to upload to MinIO: ${err.message}`)
    return null
  }
}
