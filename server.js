import { Hono } from 'hono'
import studentRoutes from './routes/studentRoutes.js'


const app = new Hono()

/* CORS Middleware
const allowedOrigins = JSON.parse(process.env.ALLOWED_ORIGINS || '[]')
// CORS Middleware (commented out as unused)

/* JWT Middleware (if needed)
app.use('/api/v1/*', jwt({
  secret: 'YOUR_PUBLIC_KEY',
  alg: 'RS256',
  aud: 'https://linux.justdo-it.local:8083',
  iss: 'https://dev-3ocho460qagqipds.us.auth0.com/',
}))
*/
// Route handler
app.use('/api/v1/student', studentRoutes)

export default app// JWT Middleware (commented out as unused)
