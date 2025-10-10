'use client'

import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Routes } from '@/config/routes'

const loginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginForm() {
  const router = useRouter()

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const onSubmit = async (data: LoginFormValues) => {
    try {
      console.log('=== STARTING LOGIN ===')
      console.log('Calling signIn with email:', data.email)

      const result = await signIn('email-password-login', {
        redirect: false, // Changed to false to see result
        callbackUrl: Routes.dashboard,
        email: data.email,
        password: data.password,
      })

      console.log('=== SIGNIN RESULT ===')
      console.log('Result:', result)
      console.log('Result error:', result?.error)
      console.log('Result status:', result?.status)
      console.log('Result ok:', result?.ok)
      console.log('Result url:', result?.url)
      console.log('=== END SIGNIN RESULT ===')

      if (result?.error) {
        form.setError('root', {
          type: 'manual',
          message: 'Invalid email or password',
        })
      } else if (result?.ok) {
        // Manually redirect on success
        router.push(Routes.dashboard)
      }
    } catch (error) {
      console.error('=== LOGIN ERROR DEBUG ===')
      console.error('Full error object:', error)
      console.error('Error type:', typeof error)
      console.error('Error message:', error?.message)
      console.error('Error stack:', error?.stack)

      // Log axios-specific error details if available
      if (error?.response) {
        console.error('Response status:', error.response.status)
        console.error('Response headers:', error.response.headers)
        console.error('Response data:', error.response.data)
      }

      if (error?.config) {
        console.error('Request URL:', error.config.url)
        console.error('Request method:', error.config.method)
        console.error('Request headers:', error.config.headers)
        console.error('Request data:', error.config.data)
      }

      console.error('User agent:', navigator.userAgent)
      console.error('Current URL:', window.location.href)
      console.error('=== END LOGIN ERROR DEBUG ===')

      form.setError('root', {
        type: 'manual',
        message: 'An unexpected error occurred. Please try again.',
      })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  placeholder='m@example.com'
                  {...field}
                  className='dark:text-white dark:bg-gray-800'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type='password'
                  {...field}
                  className='dark:text-white dark:bg-gray-800'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root && (
          <p className='text-sm font-medium text-red-500'>
            {form.formState.errors.root.message}
          </p>
        )}
        <Button
          className='w-full'
          type='submit'
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              {/* <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> */}
              Signing in...
            </>
          ) : (
            'Sign In'
          )}
        </Button>
      </form>
    </Form>
  )
}
