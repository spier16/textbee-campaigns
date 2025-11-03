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
  timeout: 30000, // 30 second timeout (increased for slower networks)
  validateStatus: function (status) {
    // Don't throw on any status code so we can log the response
    return status >= 200 && status < 600
  },
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

    // If status is not 2xx, treat as error
    if (response.status >= 300) {
      const error: any = new Error(`HTTP Error ${response.status}`)
      error.response = response
      throw error
    }

    return response
  },
  (error) => {
    console.error('=== HTTP SERVER CLIENT ERROR ===')
    console.error('Error message:', error.message)
    console.error('Error code:', error.code)
    console.error('Is timeout:', error.code === 'ECONNABORTED')
    console.error('Response status:', error?.response?.status)
    console.error('Response headers:', error?.response?.headers)
    console.error('Response data type:', typeof error?.response?.data)

    // Log full response if it's HTML (likely an error page)
    if (typeof error?.response?.data === 'string') {
      console.error('Response is string (likely HTML error page)')
      console.error('Response data (first 1000 chars):', error.response.data.substring(0, 1000))

      // Check if it's HTML
      if (error.response.data.trim().startsWith('<!')) {
        console.error('CONFIRMED: Response is HTML, not JSON')
        console.error('This usually means:')
        console.error('1. API endpoint not found (404)')
        console.error('2. Server error returning error page (500)')
        console.error('3. Network/proxy intercepting request')
        console.error('4. CORS issue returning error page')
      }
    } else {
      console.error('Response data:', error?.response?.data)
    }

    console.error('Request URL:', error?.config?.url)
    console.error('Request baseURL:', error?.config?.baseURL)
    console.error('Full URL:', error?.config?.baseURL + error?.config?.url)
    console.error('=== END HTTP CLIENT ERROR ===')
    return Promise.reject(error)
  }
)
