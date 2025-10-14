import CredentialsProvider from 'next-auth/providers/credentials'
import { httpServerClient } from './httpServerClient'
import { DefaultSession } from 'next-auth'
import { ApiEndpoints } from '@/config/api'
import { Routes } from '@/config/routes'

// add custom fields to the session and user interfaces
declare module 'next-auth' {
  interface Session {
    user: {
      phone?: string
      avatar?: string
      accessToken?: string
    } & DefaultSession['user']
  }

  interface User {
    phone?: string
    avatar?: string
    accessToken?: string
  }
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      id: 'email-password-login',
      name: 'email-password-login',
      credentials: {
        email: { label: 'email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const { email, password } = credentials
        const startTime = Date.now()

        try {
          console.log('=== STARTING AUTHORIZE ===')
          console.log('Email:', email)
          console.log('Timestamp:', new Date().toISOString())
          console.log('API Base URL:', process.env.NEXT_PUBLIC_API_BASE_URL)
          console.log('Container runtime:', process.env.CONTAINER_RUNTIME)
          console.log('Login endpoint:', ApiEndpoints.auth.login())

          const res = await httpServerClient.post(ApiEndpoints.auth.login(), {
            email,
            password,
          })

          const duration = Date.now() - startTime
          console.log('=== AUTHORIZE SUCCESS ===')
          console.log('Duration:', duration, 'ms')
          console.log('Response status:', res.status)
          console.log('Response data structure:', JSON.stringify(res.data, null, 2))
          console.log('User object:', JSON.stringify(res.data.data.user, null, 2))
          console.log('=== END AUTHORIZE SUCCESS ===')

          const user = res.data.data.user
          const accessToken = res.data.data.accessToken

          return {
            ...user,
            accessToken,
          }
        } catch (e) {
          const duration = Date.now() - startTime
          console.error('=== SERVER-SIDE LOGIN ERROR ===')
          console.error('Duration before failure:', duration, 'ms')
          console.error('Error type:', e?.constructor?.name)
          console.error('Error message:', e?.message)
          console.error('Error code:', e?.code)

          // Network-level errors (no response received)
          if (!e?.response) {
            console.error('NO RESPONSE RECEIVED - Network error')
            console.error('Possible causes:')
            console.error('  - API server is down or unreachable')
            console.error('  - Network connectivity issues')
            console.error('  - Firewall blocking the request')
            console.error('  - DNS resolution failure')
            console.error('  - Request timeout (30s)')

            if (e?.code === 'ECONNABORTED') {
              console.error('TIMEOUT: Request took longer than 30 seconds')
            } else if (e?.code === 'ECONNREFUSED') {
              console.error('CONNECTION REFUSED: API server not accepting connections')
            } else if (e?.code === 'ENOTFOUND') {
              console.error('DNS ERROR: Cannot resolve API hostname')
            }
          } else {
            // Response received but with error
            console.error('Response received with status:', e?.response?.status)
            console.error('Response headers:', JSON.stringify(e?.response?.headers, null, 2))
            console.error('Response content-type:', e?.response?.headers?.['content-type'])

            const responseData = e?.response?.data
            console.error('Response data type:', typeof responseData)

            if (typeof responseData === 'string') {
              console.error('Response data length:', responseData.length, 'chars')
              console.error('Response data (first 1000 chars):', responseData.substring(0, 1000))

              // Check if HTML response
              if (responseData.trim().startsWith('<!')) {
                console.error('========================================')
                console.error('ERROR: API returned HTML instead of JSON')
                console.error('========================================')
                console.error('This indicates:')
                console.error('  - Wrong endpoint URL (404 page)')
                console.error('  - API server error (500 error page)')
                console.error('  - Reverse proxy/load balancer error')
                console.error('  - CORS preflight failure returning error page')

                // Try to extract title from HTML for more context
                const titleMatch = responseData.match(/<title>(.*?)<\/title>/i)
                if (titleMatch) {
                  console.error('HTML Page Title:', titleMatch[1])
                }
              }
            } else {
              console.error('Response data:', JSON.stringify(responseData, null, 2))
            }
          }

          console.error('Request config:')
          console.error('  - URL:', e?.config?.url)
          console.error('  - Base URL:', e?.config?.baseURL)
          console.error('  - Full URL:', e?.config?.baseURL + e?.config?.url)
          console.error('  - Method:', e?.config?.method)
          console.error('  - Timeout:', e?.config?.timeout, 'ms')
          console.error('  - Headers:', JSON.stringify(e?.config?.headers, null, 2))

          console.error('Environment:')
          console.error('  - NEXT_PUBLIC_API_BASE_URL:', process.env.NEXT_PUBLIC_API_BASE_URL)
          console.error('  - CONTAINER_RUNTIME:', process.env.CONTAINER_RUNTIME)
          console.error('  - NODE_ENV:', process.env.NODE_ENV)

          console.error('=== END SERVER-SIDE LOGIN ERROR ===')

          return null
        }
      },
    }),
    CredentialsProvider({
      id: 'email-password-register',
      name: 'email-password-register',
      credentials: {
        email: { label: 'email', type: 'text' },
        password: { label: 'Password', type: 'password' },
        name: { label: 'Name', type: 'text' },
        phone: { label: 'Phone', type: 'text' },
      },
      async authorize(credentials) {
        const { email, password, name, phone } = credentials
        try {
          const res = await httpServerClient.post(
            ApiEndpoints.auth.register(),
            {
              email,
              password,
              name,
              phone,
            }
          )

          const user = res.data.data.user
          const accessToken = res.data.data.accessToken

          return {
            ...user,
            accessToken,
          }
        } catch (e) {
          console.log(e)
          return null
        }
      },
    }),
    CredentialsProvider({
      id: 'google-id-token-login',
      name: 'google-id-token-login',
      credentials: {
        idToken: { label: 'idToken', type: 'text' },
      },
      async authorize(credentials) {
        const { idToken } = credentials
        try {
          const res = await httpServerClient.post(
            ApiEndpoints.auth.signInWithGoogle(),
            {
              idToken,
            }
          )

          const user = res.data.data.user
          const accessToken = res.data.data.accessToken

          return {
            ...user,
            accessToken,
          }
        } catch (e) {
          console.log(e)

          return null
        }
      },
    }),
  ],
  pages: {
    signIn: Routes.login,
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      console.log('=== JWT CALLBACK ===')
      console.log('Trigger:', trigger)
      console.log('User object:', JSON.stringify(user, null, 2))
      console.log('Token object:', JSON.stringify(token, null, 2))

      if (trigger === 'update') {
        if (session.name !== token.name) {
          token.name = session.name
        }
        if (session.phone !== token.phone) {
          token.phone = session.phone
        }
        return token
      }

      if (user) {
        console.log('Setting token properties from user')
        console.log('user._id:', user._id)
        console.log('user.role:', user.role)

        token.id = user._id
        token.role = user.role
        token.accessToken = user.accessToken
        token.avatar = user.avatar
        token.phone = user.phone
      }
      console.log('=== END JWT CALLBACK ===')
      return token
    },
    async session({ session, token }): Promise<any> {
      session.user.id = token.id
      session.user.role = token.role
      session.user.accessToken = token.accessToken
      session.user.avatar = token.avatar
      session.user.phone = token.phone
      return session
    },
  },
}
