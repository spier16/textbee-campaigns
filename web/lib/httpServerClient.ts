import axios from 'axios'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { Session } from 'next-auth'

// Create a base URL that works in Docker container network if running in a container
// or falls back to the public URL if not in a container
const getServerSideBaseUrl = () => {
  // When running server-side in Docker, use the service name from docker-compose
  if (process.env.CONTAINER_RUNTIME === 'docker') {
    console.log('Running in Docker container')
    return 'http://textbee-api:3001/api/v1'
  }
  // Otherwise use the public URL
  return process.env.NEXT_PUBLIC_API_BASE_URL || ''
}

export const httpServerClient = axios.create({
  baseURL: getServerSideBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  timeout: 10000, // 10 second timeout
})

httpServerClient.interceptors.request.use(async (config) => {
  const session: Session | null = await getServerSession(authOptions as any)
  if (session?.user?.accessToken) {
    config.headers.Authorization = `Bearer ${session.user.accessToken}`
  }

  // Log request details for debugging
  console.log('=== HTTP SERVER CLIENT REQUEST ===')
  console.log('URL:', config.baseURL + config.url)
  console.log('Method:', config.method)
  console.log('Headers:', config.headers)
  console.log('=== END REQUEST ===')

  return config
})

// Add response interceptor for error logging
httpServerClient.interceptors.response.use(
  (response) => {
    console.log('=== HTTP SERVER CLIENT SUCCESS ===')
    console.log('Status:', response.status)
    console.log('URL:', response.config.url)
    console.log('=== END SUCCESS ===')
    return response
  },
  (error) => {
    console.error('=== HTTP SERVER CLIENT ERROR ===')
    console.error('Error message:', error.message)
    console.error('Response status:', error?.response?.status)
    console.error('Response data type:', typeof error?.response?.data)
    console.error('Response data (first 500 chars):',
      typeof error?.response?.data === 'string'
        ? error.response.data.substring(0, 500)
        : error?.response?.data
    )
    console.error('=== END HTTP CLIENT ERROR ===')
    return Promise.reject(error)
  }
)
